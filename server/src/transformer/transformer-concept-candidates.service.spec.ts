import { ConflictException, NotFoundException } from '@nestjs/common'
import type { AiService } from '../ai/ai.service'
import type { ArticlePipelineService } from './article-pipeline.service'
import type { PipelineService } from './pipeline.service'
import type { LearningConceptCandidate, LearningLayer } from './schemas'
import { TransformerService } from './transformer.service'
import type { ArticleJsonV2 } from './transformer.types'

/**
 * DET-283 per-section concept candidates at the service boundary. We verify the
 * persistence concurrency pattern (per-article row lock + re-read, mirroring the
 * illustration `withLockedPlan`), the replace-pending / keep-decided re-extraction
 * rule, the validate→Concept promotion (the user's explicit "Validate" creates an
 * INBOX Concept exactly once, with verbatim source-block provenance — dismissal
 * and re-validation never duplicate it), and that the extractor receives a v2
 * article (legacy v1 stored JSON is adapted first).
 */

const v2Article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'T', source: 'original' },
  abstract: [],
  sections: [
    {
      id: 's1',
      heading: 'H',
      headingSource: 'original',
      sourceBlockIds: ['b1'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'body',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

function candidate(
  over: Partial<LearningConceptCandidate> = {},
): LearningConceptCandidate {
  return {
    id: 'cc1',
    sectionId: 's1',
    label: 'L',
    definition: 'D',
    sourceBlockIds: ['b1'],
    aiAssisted: true,
    validationStatus: 'pending',
    ...over,
  }
}

/** A Prisma stub holding one owned article whose learningLayer we mutate. */
function makeHarness(opts: {
  learningLayer?: LearningLayer | null
  articleJson?: unknown
  extractResult?: LearningConceptCandidate[]
}) {
  const article: Record<string, unknown> = {
    id: 'a1',
    sourceId: 'src1',
    workspaceId: 'w1',
    blocksVersion: 1,
    articleJson: 'articleJson' in opts ? opts.articleJson : v2Article,
    learningLayer: opts.learningLayer ?? null,
  }

  const prisma = {
    $transaction: (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    $queryRaw: jest.fn(async () => []),
    transformedArticle: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'a1' ? { ...article } : null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'a1' ? { learningLayer: article.learningLayer } : null,
      ),
      update: jest.fn(
        async ({ data }: { data: { learningLayer: unknown } }) => {
          article.learningLayer = data.learningLayer
          return { ...article }
        },
      ),
    },
    transformerSource: {
      findUnique: jest.fn(async () => ({
        type: 'URL',
        url: 'https://example.com/a',
      })),
    },
    transformerSourceBlock: {
      findMany: jest.fn(async () => [{ text: 'Verbatim source block text.' }]),
    },
    concept: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'con-1',
        ...data,
      })),
    },
  }

  const extractSectionConcepts = jest.fn(
    async (
      _article: ArticleJsonV2,
      _sectionId: string,
      _sourceId: string,
      _blocksVersion: number,
    ) => opts.extractResult ?? [candidate()],
  )
  const articlePipeline = {
    extractSectionConcepts,
  } as unknown as ArticlePipelineService

  const conceptState = { recordCapture: jest.fn(async () => undefined) }

  const service = new TransformerService(
    prisma as never,
    {} as PipelineService,
    articlePipeline,
    {} as AiService,
    conceptState as never,
    {} as never,
  )
  return { service, prisma, article, extractSectionConcepts, conceptState }
}

describe('TransformerService concept candidates (DET-283)', () => {
  it('extracts + appends candidates under the row lock', async () => {
    const { service, prisma, article } = makeHarness({})
    const layer = await service.extractSectionConcepts('u1', 'a1', 's1')

    // The lock + re-read were used (no naive read-modify-write).
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(prisma.transformedArticle.findUnique).toHaveBeenCalled()
    expect(layer.conceptCandidates).toHaveLength(1)
    expect(
      (article.learningLayer as LearningLayer).conceptCandidates,
    ).toHaveLength(1)
  })

  it('adapts legacy v1 stored JSON to v2 before extracting', async () => {
    const v1 = {
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections: [],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
    }
    const { service, extractSectionConcepts } = makeHarness({ articleJson: v1 })
    await service.extractSectionConcepts('u1', 'a1', 's1')
    // The article handed to the pipeline must be v2 (the read-boundary adapts it).
    const passed = extractSectionConcepts.mock.calls[0][0]
    expect(passed.schemaVersion).toBe('v2')
  })

  it('409 when the article has not been generated yet', async () => {
    const { service } = makeHarness({ articleJson: null })
    await expect(
      service.extractSectionConcepts('u1', 'a1', 's1'),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('re-extraction REPLACES pending candidates but KEEPS validated/dismissed', async () => {
    const existing: LearningConceptCandidate[] = [
      candidate({ id: 'old-pending', validationStatus: 'pending' }),
      candidate({ id: 'old-validated', validationStatus: 'validated' }),
      candidate({ id: 'old-dismissed', validationStatus: 'dismissed' }),
      // a pending candidate from ANOTHER section must be untouched
      candidate({ id: 'other-pending', sectionId: 's2' }),
    ]
    const { service } = makeHarness({
      learningLayer: {
        concepts: [],
        retrievalPrompts: [],
        conceptCandidates: existing,
      },
      extractResult: [candidate({ id: 'fresh', validationStatus: 'pending' })],
    })
    const layer = await service.extractSectionConcepts('u1', 'a1', 's1')
    const ids = (layer.conceptCandidates ?? []).map((c) => c.id).sort()
    expect(ids).toEqual(
      ['fresh', 'old-dismissed', 'old-validated', 'other-pending'].sort(),
    )
  })

  it('validating a candidate creates an INBOX Concept with source provenance and stamps conceptId', async () => {
    const { service, prisma, conceptState } = makeHarness({
      learningLayer: {
        concepts: [],
        retrievalPrompts: [],
        conceptCandidates: [candidate({ id: 'cc1' })],
      },
    })
    const layer = await service.updateLearningItem(
      'u1',
      'a1',
      'cc1',
      'validated',
    )
    expect(layer.conceptCandidates?.[0].validationStatus).toBe('validated')
    expect(layer.conceptCandidates?.[0].conceptId).toBe('con-1')
    // The Concept row carries the candidate + verbatim source-block provenance.
    expect(prisma.concept.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'L',
        summary: 'D',
        sourceText: 'Verbatim source block text.',
        sourceUrl: 'https://example.com/a',
        captureSource: 'URL',
        userId: 'u1',
        workspaceId: 'w1',
      }),
    })
    // Its cognitive history opens at capture, inside the same transaction.
    expect(conceptState.recordCapture).toHaveBeenCalledWith(
      'con-1',
      'u1',
      expect.anything(),
      expect.any(String),
    )
  })

  it('re-validating a candidate that already has a conceptId does NOT create a second Concept', async () => {
    const { service, prisma } = makeHarness({
      learningLayer: {
        concepts: [],
        retrievalPrompts: [],
        conceptCandidates: [
          candidate({
            id: 'cc1',
            validationStatus: 'dismissed',
            conceptId: 'con-existing',
          }),
        ],
      },
    })
    const layer = await service.updateLearningItem(
      'u1',
      'a1',
      'cc1',
      'validated',
    )
    expect(layer.conceptCandidates?.[0].conceptId).toBe('con-existing')
    expect(prisma.concept.create).not.toHaveBeenCalled()
  })

  it('dismissing a candidate never creates a Concept', async () => {
    const { service, prisma } = makeHarness({
      learningLayer: {
        concepts: [],
        retrievalPrompts: [],
        conceptCandidates: [candidate({ id: 'cc1' })],
      },
    })
    await service.updateLearningItem('u1', 'a1', 'cc1', 'dismissed')
    expect(prisma.concept.create).not.toHaveBeenCalled()
  })

  it('updateLearningItem still flips a DET-258 study concept without creating a Concept row', async () => {
    const { service, prisma } = makeHarness({
      learningLayer: {
        concepts: [
          {
            id: 'k1',
            label: 'L',
            definition: 'D',
            sourceBlockIds: ['b1'],
            validationStatus: 'pending',
          },
        ],
        retrievalPrompts: [],
      },
    })
    const layer = await service.updateLearningItem(
      'u1',
      'a1',
      'k1',
      'dismissed',
    )
    expect(layer.concepts[0].validationStatus).toBe('dismissed')
    expect(prisma.concept.create).not.toHaveBeenCalled()
  })

  it('404 when the item id is in neither concepts nor candidates', async () => {
    const { service } = makeHarness({
      learningLayer: { concepts: [], retrievalPrompts: [] },
    })
    await expect(
      service.updateLearningItem('u1', 'a1', 'ghost', 'validated'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
