import {
  ArticlePipelineV3Service,
  mapStatus,
} from './article-pipeline-v3.service'
import {
  ARTICLE_SCHEMA_VERSION_V3,
  type ArticleJsonV3,
  type SourceKind,
} from './v3.types'
import type { V3GeneratorService } from './v3-generator.service'

/** A v3 article that passes every quality gate (covers its one important block). */
function passingArticle(
  sourceKind: SourceKind = 'structured_article',
): ArticleJsonV3 {
  return {
    schemaVersion: ARTICLE_SCHEMA_VERSION_V3,
    sourceKind,
    shape: 'overview',
    title: { text: 'T', provenance: 'scaffold' },
    summary: { text: 'S', provenance: 'scaffold' },
    sections: [
      {
        id: 'sec-0',
        heading: 'H',
        headingProvenance: 'scaffold',
        sourceBlockIds: ['b0'],
        blocks: [
          {
            id: 'sec-0-b-0',
            type: 'paragraph',
            text: 't',
            sourceBlockIds: ['b0'],
            provenance: 'source',
            fidelityRisk: 'low',
          },
        ],
      },
    ],
    learning: {
      learningPath: [],
      keyConcepts: [],
      keyClaims: [],
      retrievalPrompts: [
        { id: 'prompt-0', prompt: 'p', sourceBlockIds: ['b0'] },
      ],
      sourceNotes: [],
    },
    provenance: {
      totalBlocks: 1,
      sourceGroundedBlocks: 1,
      scaffoldBlocks: 0,
      groundedPercent: 100,
    },
  }
}

/** A v3 article that misses its important block (coverage 0 → BLOCKED). */
function blockedArticle(): ArticleJsonV3 {
  const a = passingArticle()
  a.sections[0].sourceBlockIds = []
  a.sections[0].blocks[0].sourceBlockIds = []
  a.sections[0].blocks[0].provenance = 'scaffold'
  a.learning.retrievalPrompts = []
  return a
}

interface PrismaStub {
  transformerSourceBlock: { findMany: jest.Mock }
  transformedArticle: { update: jest.Mock }
}

function makePrisma(): PrismaStub {
  return {
    transformerSourceBlock: {
      findMany: jest.fn(async () => [
        {
          id: 'b0',
          blockType: 'PARAGRAPH',
          text: 'A method is defined as a procedure.',
          classification: 'METHOD',
          removable: false,
        },
      ]),
    },
    transformedArticle: { update: jest.fn(async () => ({})) },
  }
}

describe('mapStatus (DET-343)', () => {
  it('maps the v3 status onto the row enum', () => {
    expect(mapStatus('READY_FOR_REVIEW')).toBe('FINAL')
    expect(mapStatus('BLOCKED')).toBe('BLOCKED')
    expect(mapStatus('NEEDS_REGENERATION')).toBe('BLOCKED')
    expect(mapStatus('FAILED')).toBe('FAILED')
  })
})

describe('ArticlePipelineV3Service.run (DET-343)', () => {
  it('persists a FINAL article + READY_FOR_REVIEW quality report on a clean run', async () => {
    const prisma = makePrisma()
    const generator = {
      generate: jest.fn(async () => passingArticle()),
      regenerate: jest.fn(),
    } as unknown as V3GeneratorService

    const service = new ArticlePipelineV3Service(prisma as never, generator)
    await service.run('art-1', 'src-1', 3)

    // Find the terminal persist (the one that writes status + articleJsonV3).
    const terminal = prisma.transformedArticle.update.mock.calls
      .map((c) => c[0].data)
      .find((d: Record<string, unknown>) => 'articleJsonV3' in d)
    expect(terminal.status).toBe('FINAL')
    expect(terminal.pipelineVersion).toBe('v3')
    expect((terminal.qualityReport as { status: string }).status).toBe(
      'READY_FOR_REVIEW',
    )
    expect(generator.regenerate).not.toHaveBeenCalled()
  })

  it('runs one targeted regeneration pass when the first attempt is blocked', async () => {
    const prisma = makePrisma()
    const generator = {
      generate: jest.fn(async () => blockedArticle()),
      regenerate: jest.fn(async () => passingArticle()),
    } as unknown as V3GeneratorService

    const service = new ArticlePipelineV3Service(prisma as never, generator)
    await service.run('art-2', 'src-1', 3)

    expect(generator.regenerate).toHaveBeenCalledTimes(1)
    const terminal = prisma.transformedArticle.update.mock.calls
      .map((c) => c[0].data)
      .find((d: Record<string, unknown>) => 'articleJsonV3' in d)
    // The regenerated (passing) article wins → FINAL.
    expect(terminal.status).toBe('FINAL')
  })

  it('persists FAILED when generation throws', async () => {
    const prisma = makePrisma()
    const generator = {
      generate: jest.fn(async () => {
        throw new Error('llm exploded')
      }),
      regenerate: jest.fn(),
    } as unknown as V3GeneratorService

    const service = new ArticlePipelineV3Service(prisma as never, generator)
    await service.run('art-3', 'src-1', 3)

    const failed = prisma.transformedArticle.update.mock.calls
      .map((c) => c[0].data)
      .find((d: Record<string, unknown>) => d.status === 'FAILED')
    expect(failed).toBeDefined()
    expect(failed.error).toMatch(/llm exploded/)
  })
})
