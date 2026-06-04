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
 * rule, that validating a candidate only flips its status (NEVER creating any
 * Concept row — there is no Concept-row write path here at all), and that the
 * extractor receives a v2 article (legacy v1 stored JSON is adapted first).
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

  const service = new TransformerService(
    prisma as never,
    {} as PipelineService,
    articlePipeline,
    {} as AiService,
  )
  return { service, prisma, article, extractSectionConcepts }
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

  it('updateLearningItem flips a candidate status without creating any Concept row', async () => {
    const { service, prisma, article } = makeHarness({
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
    // Only the learningLayer JSON was written — no other table touched.
    const updateKeys = prisma.transformedArticle.update.mock.calls.flatMap(
      (call) => Object.keys((call[0] as { data: object }).data),
    )
    expect(updateKeys).toEqual(['learningLayer'])
    // The article object only ever carried a learningLayer mutation.
    expect(Object.keys(article)).not.toContain('concept')
  })

  it('updateLearningItem still flips a concept (untouched path)', async () => {
    const { service } = makeHarness({
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
