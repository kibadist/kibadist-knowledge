import { TransformedArticleStatus } from '@kibadist/prisma'

import { AiService } from '../ai/ai.service'
import { ArticleEnrichmentService } from './article-enrichment.service'
import { ArticleGeneratorService } from './article-generator.service'
import { ArticlePipelineService } from './article-pipeline.service'
import { CalloutGeneratorService } from './callout-generator.service'
import { ConceptualSegmentationService } from './conceptual-segmentation.service'
import { EditorialLayoutService } from './editorial-layout.service'
import { FidelityCheckerService } from './fidelity-checker.service'
import { IllustrationPlannerService } from './illustration-planner.service'
import { LearningLayerService } from './learning-layer.service'
import { LearningPromptsService } from './learning-prompts.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import { SourceDiagnosisService } from './source-diagnosis.service'
import { StructureModelService } from './structure-model.service'
import { TableGeneratorService } from './table-generator.service'
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
  // loadSourceMeta (DET-345) reads the source row for detection metadata.
  const transformerSource = {
    findUnique: jest.fn(async () => ({
      type: 'TEXT',
      url: null,
      fileName: null,
      metadata: null,
    })),
  }
  const prisma = {
    transformedArticle,
    transformerSourceBlock,
    transformerSource,
  }
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
  sections: [
    {
      id: 's1',
      heading: 'Only section',
      headingSource: 'original',
      sourceBlockIds: ['b1'],
      blocks: [
        {
          id: 'sp1',
          type: 'paragraph',
          text: 'x',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  // A caveat backed by b1 overlaps the only section, so the pipeline's
  // deterministic placement (DET-272) must anchor it beside s1.
  caveats: [{ text: 'A caveat', sourceBlockIds: ['b1'] }],
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
  emphasisChanges: [],
  structuralFindings: [],
}

function makeServices(overrides: {
  structure?: Partial<StructureModelService>
  segmentation?: Partial<ConceptualSegmentationService>
  plan?: Partial<ReshapingPlanService>
  generate?: Partial<ArticleGeneratorService>
  fidelity?: Partial<FidelityCheckerService>
}) {
  const structure = {
    // A minimal valid structure model: one preserved claim grounded in b1, which
    // the article represents — so reading-aids highlight selection (DET-274) can
    // pick it deterministically.
    build: jest.fn(async () => ({
      title: null,
      subtitle: null,
      claims: [{ text: 'A claim', sourceBlockIds: ['b1'] }],
      definitions: [],
      examples: [],
      caveats: [],
      terminology: [],
      originalOutline: [],
      noiseDecisions: [],
      uncertainBlockIds: [],
    })),
    ...overrides.structure,
  } as unknown as StructureModelService
  const segmentation = {
    // A minimal segmentation: one high-importance segment over b1, no orphans.
    segment: jest.fn(async () => ({
      segments: [
        {
          id: 'seg-0',
          title: 'A claim',
          role: 'orientation',
          sourceBlockIds: ['b1'],
          importance: 'high',
          summary: 'A claim',
          mustPreserveClaims: [],
          suggestedArticlePlacement: 'main_body',
        },
      ],
      unsegmentedBlocks: [],
      warnings: [],
    })),
    ...overrides.segmentation,
  } as unknown as ConceptualSegmentationService
  const plan = {
    build: jest.fn(async () => ({ removedBlocks: [] })),
    ...overrides.plan,
  } as unknown as ReshapingPlanService
  const generate = {
    generate: jest.fn(async () => sampleArticle),
    ...overrides.generate,
  } as unknown as ArticleGeneratorService
  const callouts = {
    generate: jest.fn(async () => []),
  } as unknown as CalloutGeneratorService
  const tables = {
    generate: jest.fn(async () => []),
  } as unknown as TableGeneratorService
  const fidelity = {
    check: jest.fn(async () => okReport),
    ...overrides.fidelity,
  } as unknown as FidelityCheckerService
  const illustrations = {
    plan: jest.fn(async () => ({ suggestions: [] })),
  } as unknown as IllustrationPlannerService
  const enrichment = {
    build: jest.fn(async () => ({ keyFacts: [] })),
  } as unknown as ArticleEnrichmentService
  const editorialLayout = {
    build: jest.fn(async () => ({})),
  } as unknown as EditorialLayoutService
  const learning = {} as LearningLayerService
  const learningPrompts = {
    build: jest.fn(async () => ({ retrievalPrompts: [], misconceptions: [] })),
  } as unknown as LearningPromptsService
  // Real diagnosis service over a stub ConfigService (v3 flag off ⇒ always v2).
  const diagnosis = new SourceDiagnosisService({
    get: () => undefined,
  } as never)
  const ai = {
    image: jest.fn(async () => ({
      base64: '',
      mediaType: 'image/png',
      width: 1,
      height: 1,
      model: 'stub',
    })),
    providerName: 'stub',
  } as unknown as AiService
  return {
    structure,
    segmentation,
    plan,
    generate,
    callouts,
    tables,
    fidelity,
    illustrations,
    enrichment,
    editorialLayout,
    learning,
    learningPrompts,
    diagnosis,
    ai,
  }
}

describe('ArticlePipelineService.run', () => {
  it('walks MODELING→PLANNING→GENERATING→CHECKING→FINAL when fidelity approves', async () => {
    const { prisma, statusLog, article } = makeStubPrisma()
    const s = makeServices({})
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.generate,
      s.callouts,
      s.tables,
      s.fidelity,
      s.illustrations,
      s.enrichment,
      s.editorialLayout,
      s.learning,
      s.learningPrompts,
      s.ai,
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

    // The pipeline attaches deterministic inline callout placements (DET-272) to
    // the stored articleJson — computed in code, not by the generator stub.
    const stored = article.articleJson as ArticleJsonV2
    expect(stored.calloutPlacements).toBeDefined()
    expect(stored.calloutPlacements?.bySection.s1).toHaveLength(1)
    expect(stored.calloutPlacements?.bySection.s1[0]).toMatchObject({
      kind: 'caveat',
      text: 'A caveat',
      id: 'co-caveat-0',
    })
    expect(stored.calloutPlacements?.unplaced).toEqual([])

    // Reading aids (DET-274) are computed in code and attached to the stored
    // articleJson: TOC from the heading hierarchy, reading time, and a
    // source-grounded highlight selected from the structure model's claims.
    expect(stored.readingAids).toBeDefined()
    expect(stored.readingAids?.toc).toEqual([
      { sectionId: 's1', heading: 'Only section', headingSource: 'original' },
    ])
    expect(stored.readingAids?.readingTime.minutes).toBeGreaterThanOrEqual(1)
    expect(stored.readingAids?.highlights).toEqual([
      { text: 'A claim', sourceBlockIds: ['b1'] },
    ])

    // The fidelity checker received the ENRICHED artifact (callouts + reading
    // aids attached) so it can validate the highlights as traceable fragments.
    const checkMock = s.fidelity.check as unknown as jest.Mock
    const checkArg = checkMock.mock.calls[0][0] as ArticleJsonV2
    expect(checkArg.readingAids).toBeDefined()
    expect(checkArg.calloutPlacements).toBeDefined()
  })

  it('persists the conceptual segmentation and feeds it to the outline (DET-347)', async () => {
    const { prisma, article } = makeStubPrisma()
    const s = makeServices({})
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.generate,
      s.callouts,
      s.tables,
      s.fidelity,
      s.illustrations,
      s.enrichment,
      s.editorialLayout,
      s.learning,
      s.learningPrompts,
      s.ai,
    )

    await pipeline.run('a1', 'src1', 1)

    // Segmentation ran and its artifact was persisted onto `segments`.
    expect(
      s.segmentation.segment as unknown as jest.Mock,
    ).toHaveBeenCalledTimes(1)
    expect(article.segments).toBeTruthy()

    // The reshaping plan (outline) consumed the segmentation as its 3rd argument.
    const planMock = s.plan.build as unknown as jest.Mock
    const segmentationArg = planMock.mock.calls[0][2]
    expect(segmentationArg).toBeTruthy()
    expect(segmentationArg.segments[0].id).toBe('seg-0')
  })

  it('degrades to no-segmentation (outline still runs) when segmentation throws', async () => {
    const { prisma, statusLog, article } = makeStubPrisma()
    const s = makeServices({
      segmentation: {
        segment: jest.fn(async () => {
          throw new Error('segmentation blew up')
        }),
      },
    })
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.generate,
      s.callouts,
      s.tables,
      s.fidelity,
      s.illustrations,
      s.enrichment,
      s.editorialLayout,
      s.learning,
      s.learningPrompts,
      s.ai,
    )

    await pipeline.run('a1', 'src1', 1)

    // A segmentation failure must NOT fail the article — it still reaches FINAL,
    // and the outline was called with a null segmentation (degraded path).
    expect(statusLog).toContain(TransformedArticleStatus.FINAL)
    expect(article.segments).toBeFalsy()
    const planMock = s.plan.build as unknown as jest.Mock
    expect(planMock.mock.calls[0][2]).toBeNull()
  })

  it('ends BLOCKED when the fidelity gate rejects', async () => {
    const { prisma, statusLog } = makeStubPrisma()
    const blockedReport: FidelityReport = { ...okReport, approved: false }
    const s = makeServices({
      fidelity: { check: jest.fn(async () => blockedReport) },
    })
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.generate,
      s.callouts,
      s.tables,
      s.fidelity,
      s.illustrations,
      s.enrichment,
      s.editorialLayout,
      s.learning,
      s.learningPrompts,
      s.ai,
    )

    await pipeline.run('a1', 'src1', 1)

    expect(statusLog).toContain(TransformedArticleStatus.BLOCKED)
    expect(statusLog).not.toContain(TransformedArticleStatus.FINAL)
  })

  it('attaches the v3 status + quality report to the article JSON when gates pass (DET-355)', async () => {
    const { prisma, article } = makeStubPrisma()
    const s = makeServices({})
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.generate,
      s.callouts,
      s.tables,
      s.fidelity,
      s.illustrations,
      s.enrichment,
      s.editorialLayout,
      s.learning,
      s.learningPrompts,
      s.ai,
    )

    await pipeline.run('a1', 'src1', 1)

    // The persisted article JSON carries the gate-passed v3 status + a complete
    // quality report (the v3 reader reads these straight from the JSON).
    const stored = article.articleJson as ArticleJsonV2 & {
      status: string
      qualityReport: { blockerReasons: unknown[]; regenerationHints: unknown[] }
    }
    expect(stored.status).toBe('READY_FOR_REVIEW')
    expect(stored.qualityReport).toBeDefined()
    expect(stored.qualityReport.blockerReasons).toEqual([])
    expect(stored.qualityReport.regenerationHints).toEqual([])
  })

  it('records a fidelity blocker reason on the JSON when fidelity rejects (DET-355)', async () => {
    const { prisma, article } = makeStubPrisma()
    const blockedReport: FidelityReport = { ...okReport, approved: false }
    const s = makeServices({
      fidelity: { check: jest.fn(async () => blockedReport) },
    })
    const pipeline = new ArticlePipelineService(
      prisma as never,
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.generate,
      s.callouts,
      s.tables,
      s.fidelity,
      s.illustrations,
      s.enrichment,
      s.editorialLayout,
      s.learning,
      s.learningPrompts,
      s.ai,
    )

    await pipeline.run('a1', 'src1', 1)

    const stored = article.articleJson as ArticleJsonV2 & {
      status: string
      qualityReport: { blockerReasons: { code: string }[] }
    }
    expect(stored.status).toBe('BLOCKED_FIDELITY')
    expect(stored.qualityReport.blockerReasons.map((r) => r.code)).toContain(
      'fidelity',
    )
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
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.generate,
      s.callouts,
      s.tables,
      s.fidelity,
      s.illustrations,
      s.enrichment,
      s.editorialLayout,
      s.learning,
      s.learningPrompts,
      s.ai,
    )

    await pipeline.run('a1', 'src1', 1)

    expect(statusLog).toContain(TransformedArticleStatus.FAILED)
    expect(statusLog).not.toContain(TransformedArticleStatus.FINAL)
    expect(String(article.error)).toMatch(/unknown block ids/i)
  })
})
