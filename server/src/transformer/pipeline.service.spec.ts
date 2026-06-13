import {
  TransformedArticleStatus,
  TransformerBlockType,
  TransformerSourceStatus,
  TransformerSourceType,
} from '@kibadist/prisma'

import type { AiService } from '../ai/ai.service'
import { BlockClassifierService } from './block-classifier.service'
import { BlockRoleClassifierService } from './block-role-classifier.service'
import { PipelineService } from './pipeline.service'

/**
 * A minimal in-memory PrismaService stub: one source row + its block rows. Only
 * the methods the pipeline touches are implemented. `statusLog` records every
 * status the source passed through, so a test can assert the transition order.
 */
function makeStubPrisma(source: Record<string, unknown>) {
  const blocks: Record<string, unknown>[] = []
  const statusLog: TransformerSourceStatus[] = []

  const transformerSource = {
    findUnique: jest.fn(async () => ({ ...source })),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(source, data)
      if (data.status) statusLog.push(data.status as TransformerSourceStatus)
      return { ...source }
    }),
    updateMany: jest.fn(async () => ({ count: 0 })),
  }
  const transformerSourceBlock = {
    createMany: jest.fn(
      async ({ data }: { data: Record<string, unknown>[] }) => {
        for (const row of data)
          blocks.push({ id: `blk-${blocks.length}`, ...row })
        return { count: data.length }
      },
    ),
    findMany: jest.fn(async () =>
      blocks.map((b) => ({
        id: b.id,
        orderIndex: b.orderIndex,
        blockType: b.blockType,
        text: b.text,
      })),
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string }
        data: Record<string, unknown>
      }) => {
        const row = blocks.find((b) => b.id === where.id)
        if (row) Object.assign(row, data)
        return row
      },
    ),
  }
  const transformedArticle = {
    updateMany: jest.fn(async () => ({ count: 0 })),
  }
  const prisma = {
    transformerSource,
    transformerSourceBlock,
    transformedArticle,
    // The pipeline uses the array form of $transaction.
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { prisma, blocks, statusLog }
}

/** A classifier that marks every block UNCERTAIN (no real AI). */
function stubClassifier(): BlockClassifierService {
  const ai = { complete: jest.fn() } as unknown as AiService
  const c = new BlockClassifierService(ai)
  jest.spyOn(c, 'classify').mockImplementation(async (input) => {
    const map = new Map()
    for (const b of input) {
      map.set(b.index, {
        index: b.index,
        classification: 'UNCERTAIN',
        removable: false,
        noiseReason: null,
      })
    }
    return map
  })
  return c
}

/** A role classifier that marks every block UNKNOWN / main_body (no real AI). */
function stubRoleClassifier(): BlockRoleClassifierService {
  const ai = { complete: jest.fn() } as unknown as AiService
  const c = new BlockRoleClassifierService(ai)
  jest.spyOn(c, 'classify').mockImplementation(async (input) => {
    const map = new Map()
    for (const b of input) {
      map.set(b.index, {
        index: b.index,
        role: 'UNKNOWN',
        importance: 'LOW',
        placement: 'MAIN_BODY',
        reason: null,
        confidence: 0,
      })
    }
    return map
  })
  return c
}

describe('PipelineService.run', () => {
  it('text source: walks INGESTED→EXTRACTING→EXTRACTED→SEGMENTED→CLASSIFYING→READY', async () => {
    const { prisma, blocks, statusLog } = makeStubPrisma({
      id: 's1',
      type: TransformerSourceType.TEXT,
      status: TransformerSourceStatus.INGESTED,
      rawContent: 'First paragraph here.\n\nSecond paragraph here.',
      rawFile: null,
      url: null,
      blocksVersion: 0,
      metadata: null,
    })
    const pipeline = new PipelineService(
      prisma as never,
      stubClassifier(),
      stubRoleClassifier(),
    )

    await pipeline.run('s1')

    expect(statusLog).toEqual([
      TransformerSourceStatus.EXTRACTING,
      TransformerSourceStatus.EXTRACTED,
      TransformerSourceStatus.SEGMENTED,
      TransformerSourceStatus.CLASSIFYING,
      TransformerSourceStatus.READY,
    ])
    // Blocks were written at the bumped version (0 → 1) and classified.
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.every((b) => b.version === 1)).toBe(true)
    expect(blocks.every((b) => b.classificationStatus === 'classified')).toBe(
      true,
    )
    // Role classification (DET-346) is persisted alongside the noise class.
    expect(blocks.every((b) => b.roleStatus === 'classified')).toBe(true)
    expect(blocks.every((b) => b.role === 'UNKNOWN')).toBe(true)
    expect(blocks.every((b) => b.placement === 'MAIN_BODY')).toBe(true)
  })

  it('PDF source with no file bytes → EXTRACTION_FAILED with a message', async () => {
    const source: Record<string, unknown> = {
      id: 's2',
      type: TransformerSourceType.PDF,
      status: TransformerSourceStatus.INGESTED,
      rawContent: null,
      rawFile: null, // missing bytes triggers the failure
      url: null,
      blocksVersion: 0,
      metadata: null,
    }
    const { prisma, statusLog } = makeStubPrisma(source)
    const pipeline = new PipelineService(
      prisma as never,
      stubClassifier(),
      stubRoleClassifier(),
    )

    await pipeline.run('s2')

    expect(statusLog).toContain(TransformerSourceStatus.EXTRACTION_FAILED)
    expect(statusLog).not.toContain(TransformerSourceStatus.READY)
    expect(String(source.extractionError)).toMatch(/file bytes/i)
  })

  it('does not double-run a source already in flight (in-process guard)', async () => {
    const { prisma } = makeStubPrisma({
      id: 's3',
      type: TransformerSourceType.TEXT,
      status: TransformerSourceStatus.INGESTED,
      rawContent: 'Some text.',
      rawFile: null,
      url: null,
      blocksVersion: 0,
      metadata: null,
    })
    const pipeline = new PipelineService(
      prisma as never,
      stubClassifier(),
      stubRoleClassifier(),
    )

    await Promise.all([pipeline.run('s3'), pipeline.run('s3')])

    // The second concurrent call is skipped: findUnique runs at most once.
    expect(prisma.transformerSource.findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('PipelineService.onApplicationBootstrap (startup sweep)', () => {
  it('sweeps orphaned non-terminal rows to FAILED with a re-run message', async () => {
    const { prisma } = makeStubPrisma({})
    prisma.transformerSource.updateMany.mockResolvedValueOnce({ count: 2 })
    prisma.transformedArticle.updateMany.mockResolvedValueOnce({ count: 1 })
    const pipeline = new PipelineService(
      prisma as never,
      stubClassifier(),
      stubRoleClassifier(),
    )

    await pipeline.onApplicationBootstrap()

    // Sources: non-terminal statuses → FAILED + interrupted message.
    expect(prisma.transformerSource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: [
              TransformerSourceStatus.INGESTED,
              TransformerSourceStatus.EXTRACTING,
              TransformerSourceStatus.EXTRACTED,
              TransformerSourceStatus.SEGMENTED,
              TransformerSourceStatus.CLASSIFYING,
            ],
          },
        },
        data: {
          status: TransformerSourceStatus.FAILED,
          extractionError: 'interrupted by restart; re-run',
        },
      }),
    )
    // Articles: in-flight statuses → FAILED.
    expect(prisma.transformedArticle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: expect.arrayContaining([
              TransformedArticleStatus.QUEUED,
              TransformedArticleStatus.MODELING,
              TransformedArticleStatus.PLANNING,
              TransformedArticleStatus.GENERATING,
              TransformedArticleStatus.CHECKING,
            ]),
          },
        },
        data: {
          status: TransformedArticleStatus.FAILED,
          error: 'interrupted by restart; re-run',
        },
      }),
    )
  })
})
