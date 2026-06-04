import { TransformedArticleStatus } from '@kibadist/prisma'

import { ArticleGeneratorService } from './article-generator.service'
import { ArticlePipelineService } from './article-pipeline.service'
import { FidelityCheckerService } from './fidelity-checker.service'
import { IllustrationPlannerService } from './illustration-planner.service'
import { LearningLayerService } from './learning-layer.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import { StructureModelService } from './structure-model.service'
import type { ArticleJsonV2, FidelityReport } from './transformer.types'

/** Prisma stub: one article row + one block row; records every status set. */
function makeStubPrisma() {
  const article: Record<string, unknown> = { id: 'a1' }
  const statusLog: TransformedArticleStatus[] = []
  const blockRows = [
    {
      id: 'b1',
      blockType: 'PARAGRAPH',
      text: 'content',
      classification: 'MAIN_ARGUMENT',
      removable: false,
    },
  ]
  const transformedArticle = {
    create: jest.fn(async () => ({ id: 'a1' })),
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(article, data)
      if (data.status) statusLog.push(data.status as TransformedArticleStatus)
      return { ...article }
    }),
  }
  const transformerSourceBlock = {
    findMany: jest.fn(async () => blockRows),
  }
  const prisma = { transformedArticle, transformerSourceBlock }
  return { prisma, article, statusLog }
}

// The generator now emits a NATIVE v2 article (DET-271); the pipeline's stored
// artifact is v2, so the stub mirrors that shape.
const sampleArticle: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'T', source: 'original' },
  abstract: [
    {
      id: 'p1',
      text: 'x',
      sourceBlockIds: ['b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

const okReport: FidelityReport = {
  fidelityScore: 98,
  approved: true,
  addedInformation: [],
  lostInformation: [],
  meaningChanges: [],
  unsupportedHeadings: [],
  missingCaveats: [],
  unsupportedExamples: [],
}

function makeServices(overrides: {
  structure?: Partial<StructureModelService>
  plan?: Partial<ReshapingPlanService>
  generate?: Partial<ArticleGeneratorService>
  fidelity?: Partial<FidelityCheckerService>
}) {
  const structure = {
    build: jest.fn(async () => ({})),
    ...overrides.structure,
  } as unknown as StructureModelService
  const plan = {
    build: jest.fn(async () => ({ removedBlocks: [] })),
    ...overrides.plan,
  } as unknown as ReshapingPlanService
  const generate = {
    generate: jest.fn(async () => sampleArticle),
    ...overrides.generate,
  } as unknown as ArticleGeneratorService
  const fidelity = {
    check: jest.fn(async () => okReport),
    ...overrides.fidelity,
  } as unknown as FidelityCheckerService
  const illustrations = {} as IllustrationPlannerService
  const learning = {} as LearningLayerService
  return { structure, plan, generate, fidelity, illustrations, learning }
}

describe('ArticlePipelineService.run', () => {
  it('walks MODELING→PLANNING→GENERATING→CHECKING→FINAL when fidelity approves', async () => {
    const { prisma, statusLog, article } = makeStubPrisma()
    const s = makeServices({})
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.structure,
      s.plan,
      s.generate,
      s.fidelity,
      s.illustrations,
      s.learning,
    )

    await pipeline.run('a1', 'src1', 1)

    expect(statusLog).toEqual([
      TransformedArticleStatus.MODELING,
      TransformedArticleStatus.PLANNING,
      TransformedArticleStatus.GENERATING,
      TransformedArticleStatus.CHECKING,
      TransformedArticleStatus.FINAL,
    ])
    expect(article.fidelityScore).toBe(98)
    expect(article.articleJson).toBeTruthy()
    expect(article.coverageReport).toBeTruthy()
  })

  it('ends BLOCKED when the fidelity gate rejects', async () => {
    const { prisma, statusLog } = makeStubPrisma()
    const blockedReport: FidelityReport = { ...okReport, approved: false }
    const s = makeServices({
      fidelity: { check: jest.fn(async () => blockedReport) },
    })
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.structure,
      s.plan,
      s.generate,
      s.fidelity,
      s.illustrations,
      s.learning,
    )

    await pipeline.run('a1', 'src1', 1)

    expect(statusLog).toContain(TransformedArticleStatus.BLOCKED)
    expect(statusLog).not.toContain(TransformedArticleStatus.FINAL)
  })

  it('ends FAILED when a step throws (e.g. traceability violation after retry)', async () => {
    const { prisma, statusLog, article } = makeStubPrisma()
    const s = makeServices({
      structure: {
        build: jest.fn(async () => {
          throw new Error('Structure model references unknown block ids: x')
        }),
      },
    })
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.structure,
      s.plan,
      s.generate,
      s.fidelity,
      s.illustrations,
      s.learning,
    )

    await pipeline.run('a1', 'src1', 1)

    expect(statusLog).toContain(TransformedArticleStatus.FAILED)
    expect(statusLog).not.toContain(TransformedArticleStatus.FINAL)
    expect(String(article.error)).toMatch(/unknown block ids/i)
  })
})
