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
import { LearningOutlineService } from './learning-outline.service'
import { LearningPromptsService } from './learning-prompts.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import { SourceDiagnosisService } from './source-diagnosis.service'
import { StructureModelService } from './structure-model.service'
import { TableGeneratorService } from './table-generator.service'
import type { ArticleJsonV2, FidelityReport } from './transformer.types'
import { ArticlePipelineV3Service } from './v3/article-pipeline-v3.service'

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
  learningOutline?: Partial<LearningOutlineService>
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
  const learningOutline = {
    // A minimal valid LearningOutline (DET-348); the pipeline persists it and
    // hands it to the generator stub (which ignores it).
    build: jest.fn(async () => ({
      sourceKind: 'article',
      articleShape: 'general',
      title: { text: 'T', source: 'inferred' },
      learningPath: [],
      sections: [],
      sourceNotesPlan: { notes: [] },
      calloutPlan: [],
      tablePlan: [],
      reorderings: [],
      warnings: [],
    })),
    ...overrides.learningOutline,
  } as unknown as LearningOutlineService
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
  // v3 is off in these tests (diagnosis flag off ⇒ always v2), so the orchestrator
  // is never invoked — a bare stub satisfies the constructor.
  const pipelineV3 = {} as unknown as ArticlePipelineV3Service
  return {
    structure,
    segmentation,
    plan,
    learningOutline,
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
    pipelineV3,
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
      s.learningOutline,
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
      s.pipelineV3,
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

    // The enriched v2 article stays schemaVersion 'v2' / mode
    // 'source_preserving_article' (DET-343): 'v3' is reserved for the learning-first
    // Source-Grounded Learning Article, so the reader's `isArticleJsonV3` dispatch
    // never mis-routes a v2 article into the v3 learning reader.
    const stored = article.articleJson as ArticleJsonV2
    expect(stored.schemaVersion).toBe('v2')
    expect(stored.mode).toBe('source_preserving_article')

    // The pipeline attaches deterministic inline callout placements (DET-272) to
    // the stored articleJson — computed in code, not by the generator stub.
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
      s.learningOutline,
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
      s.pipelineV3,
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
      s.learningOutline,
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
      s.pipelineV3,
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
      s.learningOutline,
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
      s.pipelineV3,
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
      s.diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.learningOutline,
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
      s.pipelineV3,
    )

    await pipeline.run('a1', 'src1', 1)

    expect(statusLog).toContain(TransformedArticleStatus.FAILED)
    expect(statusLog).not.toContain(TransformedArticleStatus.FINAL)
    expect(String(article.error)).toMatch(/unknown block ids/i)
  })

  it('routes a v3-target source to the v3 pipeline and persists the learning-first article (DET-343)', async () => {
    const { prisma, statusLog, article } = makeStubPrisma()
    const s = makeServices({})
    const v3Article = {
      schemaVersion: 'v3',
      mode: 'source_grounded_learning_article',
      status: 'READY_FOR_REVIEW',
      qualityReport: {
        importantSourceCoverageScore: 90,
        conceptCandidateCount: 2,
      },
    }
    // Force the router to pick v3 (the flag/kind gate is tested in
    // source-diagnosis.service.spec); here we assert the WIRING runs v3 instead of
    // the v2 stages and persists the learning-first article.
    const diagnosis = {
      route: () => ({
        pipeline: 'v3',
        diagnosis: {
          sourceKind: 'transcript_lesson',
          articleShape: 'lesson_article',
        },
        reason: 'forced v3 (test)',
      }),
    } as unknown as (typeof s)['diagnosis']
    const runV3 = jest.fn(async () => v3Article)
    const pipelineV3 = { run: runV3 } as unknown as (typeof s)['pipelineV3']

    const pipeline = new ArticlePipelineService(
      prisma as never,
      diagnosis,
      s.structure,
      s.segmentation,
      s.plan,
      s.learningOutline,
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
      pipelineV3,
    )

    await pipeline.run('a1', 'src1', 1)

    expect(runV3).toHaveBeenCalledTimes(1)
    const stored = article.articleJson as {
      schemaVersion: string
      mode: string
      generatedAt?: string
    }
    expect(stored.schemaVersion).toBe('v3')
    expect(stored.mode).toBe('source_grounded_learning_article')
    expect(stored.generatedAt).toBeTruthy()
    expect(statusLog).toContain(TransformedArticleStatus.FINAL)
    // The v2 stages are bypassed entirely on the v3 path.
    expect(s.structure.build).not.toHaveBeenCalled()
    expect(s.generate.generate).not.toHaveBeenCalled()
  })
})
