import { ArticleGeneratorService } from './article-generator.service'
import {
  ArticleRegenerationService,
  type RepairInput,
} from './article-regeneration.service'
import { ConceptualSegmentationService } from './conceptual-segmentation.service'
import { FidelityCheckerService } from './fidelity-checker.service'
import { LearningLayerService } from './learning-layer.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import type { SourceStructureModel } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  ConceptualSegmentation,
  CoverageReport,
  FidelityReport,
} from './transformer.types'

// --- builders ---------------------------------------------------------------

function block(id: string): ClassifiedBlockInput & { uncertain: boolean } {
  return {
    id,
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: `text ${id}`,
    removable: false,
    uncertain: false,
  }
}

function paragraph(id: string, sourceBlockIds: string[]) {
  return {
    id,
    type: 'paragraph' as const,
    text: 'x',
    sourceBlockIds,
    transformationType: 'verbatim' as const,
    fidelityRisk: 'low' as const,
  }
}

function section(
  id: string,
  blocks: ReturnType<typeof paragraph>[],
): ArticleSectionV2 {
  return {
    id,
    heading: id,
    headingSource: 'original',
    sourceBlockIds: blocks.flatMap((b) => b.sourceBlockIds),
    blocks,
  }
}

function article(sections: ArticleSectionV2[]): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections,
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
  }
}

function okFidelity(over: Partial<FidelityReport> = {}): FidelityReport {
  return {
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
    ...over,
  }
}

function coverage(over: Partial<CoverageReport> = {}): CoverageReport {
  return {
    totalBlocks: 2,
    coveragePercent: 100,
    representedBlockIds: [],
    removedBlocks: [],
    uncertainBlockIds: [],
    unrepresentedBlockIds: [],
    paragraphMap: [],
    ...over,
  }
}

const structureModel = {
  title: null,
  subtitle: null,
  claims: [],
  definitions: [],
  examples: [],
  caveats: [],
  terminology: [],
  originalOutline: [],
  noiseDecisions: [],
  uncertainBlockIds: [],
} as unknown as SourceStructureModel

function makeService(mocks: {
  segment?: jest.Mock
  plan?: jest.Mock
  generate?: jest.Mock
  extract?: jest.Mock
  check?: jest.Mock
}) {
  const segmentation = {
    segment: mocks.segment ?? jest.fn(),
  } as unknown as ConceptualSegmentationService
  const reshapingPlan = {
    build: mocks.plan ?? jest.fn(async () => ({ removedBlocks: [] })),
  } as unknown as ReshapingPlanService
  const generator = {
    generate: mocks.generate ?? jest.fn(),
  } as unknown as ArticleGeneratorService
  const learning = {
    extractArticleConcepts: mocks.extract ?? jest.fn(),
  } as unknown as LearningLayerService
  const fidelity = {
    check: mocks.check ?? jest.fn(async () => okFidelity()),
  } as unknown as FidelityCheckerService
  return {
    service: new ArticleRegenerationService(
      segmentation,
      reshapingPlan,
      generator,
      learning,
      fidelity,
    ),
    segmentation,
    reshapingPlan,
    generator,
    learning,
    fidelity,
  }
}

describe('ArticleRegenerationService.repair', () => {
  it('returns no_blockers (no rerun) when nothing is wrong', async () => {
    const { service, generator } = makeService({})
    const input: RepairInput = {
      article: article([section('s1', [paragraph('p1', ['b1'])])]),
      structureModel,
      blocks: [block('b1')],
      plan: { removedBlocks: [] } as never,
      fidelity: okFidelity(),
      coverage: coverage({ representedBlockIds: ['b1'] }),
      conceptCandidates: [],
      sourceKind: 'raw_notes',
      segmentation: null,
    }
    const result = await service.repair(input)
    expect(result.report.attempted).toBe(false)
    expect(result.report.outcome).toBe('no_blockers')
    expect(generator.generate as jest.Mock).not.toHaveBeenCalled()
  })

  // --- Known failed example #1: LOW COVERAGE --------------------------------
  // A structured-web-article generation dropped a high-importance source block
  // (b2). Targeted repair re-plans + regenerates; the regenerated article adds a
  // section covering b2, prior section s1 is preserved, coverage rises to 100%,
  // and the gate now approves.
  it('repairs a low-coverage failure by re-planning and preserving prior sections', async () => {
    const regenerated = article([
      section('s1', [paragraph('p1', ['b1'])]),
      section('s2', [paragraph('p2', ['b2'])]),
    ])
    const plan = jest.fn(async () => ({ removedBlocks: [] }))
    const generate = jest.fn(async () => regenerated)
    const check = jest.fn(async () => okFidelity())
    const { service } = makeService({ plan, generate, check })

    const segmentation: ConceptualSegmentation = {
      segments: [
        {
          id: 'seg-0',
          title: 'Key idea',
          role: 'orientation',
          sourceBlockIds: ['b2'],
          importance: 'high',
          summary: 's',
          mustPreserveClaims: [],
          suggestedArticlePlacement: 'main_body',
        },
      ],
      unsegmentedBlocks: [],
      warnings: [],
    }
    const input: RepairInput = {
      article: article([section('s1', [paragraph('p1', ['b1'])])]),
      structureModel,
      blocks: [block('b1'), block('b2')],
      plan: { removedBlocks: [] } as never,
      fidelity: okFidelity({ approved: false }),
      coverage: coverage({
        coveragePercent: 50,
        representedBlockIds: ['b1'],
        unrepresentedBlockIds: ['b2'],
      }),
      conceptCandidates: [{}, {}, {}, {}, {}] as never,
      sourceKind: 'structured_web_article',
      segmentation,
    }

    const result = await service.repair(input)

    expect(result.report.outcome).toBe('repaired')
    expect(result.report.blockersBefore.map((b) => b.reason)).toContain(
      'low_coverage',
    )
    expect(result.report.blockersAfter).toEqual([])
    // Stage rerun + why are recorded.
    const action = result.report.actions.find(
      (a) => a.blockerReason === 'low_coverage',
    )
    expect(action?.stagesRerun).toEqual(['reshaping_plan', 'generation'])
    expect(action?.why.length).toBeGreaterThan(0)
    expect(action?.resolved).toBe(true)
    // Prior valid section was preserved; the gap-filling section was appended.
    expect(result.report.preservedSectionIds).toContain('s1')
    expect(result.article.sections.map((s) => s.id)).toEqual(['s1', 's2'])
    // Coverage measurably improved.
    expect(result.coverage.coveragePercent).toBe(100)
    expect(plan).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  // --- Known failed example #2: UNSUPPORTED CLAIMS --------------------------
  // A generation introduced an ungrounded paragraph (p-bad, no source backing).
  // Targeted repair prunes it deterministically (no LLM), keeps the grounded
  // section, and the gate now approves.
  it('repairs an unsupported-claims failure by pruning ungrounded content', async () => {
    const check = jest.fn(async () => okFidelity())
    const { service, generator } = makeService({ check })

    const input: RepairInput = {
      article: article([
        section('s1', [paragraph('p-good', ['b1']), paragraph('p-bad', [])]),
      ]),
      structureModel,
      blocks: [block('b1')],
      plan: { removedBlocks: [] } as never,
      fidelity: okFidelity({
        approved: false,
        addedInformation: [
          {
            severity: 'high',
            description: 'p-bad asserts a fact the source never states.',
            articleRef: 'p-bad',
          },
        ],
      }),
      coverage: coverage({
        totalBlocks: 1,
        representedBlockIds: ['b1'],
      }),
      conceptCandidates: [{}, {}, {}, {}, {}] as never,
      sourceKind: 'structured_web_article',
      segmentation: null,
    }

    const result = await service.repair(input)

    expect(result.report.outcome).toBe('repaired')
    expect(result.report.blockersBefore.map((b) => b.reason)).toContain(
      'unsupported_claims',
    )
    const action = result.report.actions.find(
      (a) => a.blockerReason === 'unsupported_claims',
    )
    expect(action?.stagesRerun).toEqual(['claim_pruning'])
    expect(action?.resolved).toBe(true)
    // The ungrounded paragraph is gone; the grounded one survives.
    const ids = result.article.sections[0].blocks.map((b) => b.id)
    expect(ids).toEqual(['p-good'])
    // Pruning is deterministic — the generator is never invoked.
    expect(generator.generate as jest.Mock).not.toHaveBeenCalled()
  })

  // --- Failed repair stays blocked with a clear explanation -----------------
  it('keeps the article blocked with an explanation when the repair does not help', async () => {
    // The regeneration still fails to cover b2, and the re-check still rejects.
    const regenerated = article([section('s1', [paragraph('p1', ['b1'])])])
    const generate = jest.fn(async () => regenerated)
    const check = jest.fn(async () => okFidelity({ approved: false }))
    const { service } = makeService({ generate, check })

    const segmentation: ConceptualSegmentation = {
      segments: [
        {
          id: 'seg-0',
          title: 'Key idea',
          role: 'orientation',
          sourceBlockIds: ['b2'],
          importance: 'high',
          summary: 's',
          mustPreserveClaims: [],
          suggestedArticlePlacement: 'main_body',
        },
      ],
      unsegmentedBlocks: [],
      warnings: [],
    }
    const input: RepairInput = {
      article: article([section('s1', [paragraph('p1', ['b1'])])]),
      structureModel,
      blocks: [block('b1'), block('b2')],
      plan: { removedBlocks: [] } as never,
      fidelity: okFidelity({ approved: false }),
      coverage: coverage({
        coveragePercent: 50,
        representedBlockIds: ['b1'],
        unrepresentedBlockIds: ['b2'],
      }),
      conceptCandidates: [{}, {}, {}, {}, {}] as never,
      sourceKind: 'structured_web_article',
      segmentation,
    }

    const result = await service.repair(input)

    expect(result.report.outcome).toBe('still_blocked')
    expect(result.report.blockersAfter.length).toBeGreaterThan(0)
    expect(result.report.explanation).toMatch(/still blocked/i)
    const action = result.report.actions.find(
      (a) => a.blockerReason === 'low_coverage',
    )
    expect(action?.resolved).toBe(false)
  })

  // --- missing_concepts re-runs learning extraction ------------------------
  it('repairs missing concepts by re-running learning extraction', async () => {
    const extract = jest.fn(async () => [{}, {}, {}, {}] as never)
    const check = jest.fn(async () => okFidelity())
    const { service } = makeService({ extract, check })

    const input: RepairInput = {
      article: article([section('s1', [paragraph('p1', ['b1'])])]),
      structureModel,
      blocks: [block('b1')],
      plan: { removedBlocks: [] } as never,
      fidelity: okFidelity({ approved: false }),
      coverage: coverage({ representedBlockIds: ['b1'] }),
      conceptCandidates: [],
      sourceKind: 'transcript_lesson',
      // Healthy segmentation so the only blocker is missing_concepts.
      segmentation: {
        segments: [
          {
            id: 'seg-0',
            title: 't',
            role: 'orientation',
            sourceBlockIds: ['b1'],
            importance: 'high',
            summary: 's',
            mustPreserveClaims: [],
            suggestedArticlePlacement: 'main_body',
          },
        ],
        unsegmentedBlocks: [],
        warnings: [],
      },
    }

    const result = await service.repair(input)

    expect(extract).toHaveBeenCalledTimes(1)
    expect(result.conceptCandidates).toHaveLength(4)
    const action = result.report.actions.find(
      (a) => a.blockerReason === 'missing_concepts',
    )
    expect(action?.stagesRerun).toEqual(['learning_extraction'])
    expect(action?.resolved).toBe(true)
    expect(result.report.outcome).toBe('repaired')
  })

  // --- poor transcript coherence re-segments before rewriting --------------
  it('repairs poor transcript coherence by re-segmenting and regenerating', async () => {
    const newSegmentation: ConceptualSegmentation = {
      segments: [
        {
          id: 'seg-0',
          title: 'Arc',
          role: 'orientation',
          sourceBlockIds: ['b1'],
          importance: 'high',
          summary: 's',
          mustPreserveClaims: [],
          suggestedArticlePlacement: 'main_body',
        },
      ],
      unsegmentedBlocks: [],
      warnings: [],
    }
    const regenerated = article([section('s1', [paragraph('p1', ['b1'])])])
    const segment = jest.fn(async () => newSegmentation)
    const plan = jest.fn(async () => ({ removedBlocks: [] }))
    const generate = jest.fn(async () => regenerated)
    const check = jest.fn(async () => okFidelity())
    const { service } = makeService({ segment, plan, generate, check })

    const input: RepairInput = {
      article: article([section('s1', [paragraph('p1', ['b1'])])]),
      structureModel,
      blocks: [block('b1')],
      plan: { removedBlocks: [] } as never,
      fidelity: okFidelity({ approved: false }),
      coverage: coverage({ representedBlockIds: ['b1'] }),
      conceptCandidates: [{}, {}, {}, {}, {}] as never,
      sourceKind: 'transcript_lesson',
      // No segmentation ⇒ the coherence blocker fires.
      segmentation: null,
    }

    const result = await service.repair(input)

    expect(segment).toHaveBeenCalledTimes(1)
    expect(plan).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledTimes(1)
    const action = result.report.actions.find(
      (a) => a.blockerReason === 'poor_transcript_coherence',
    )
    expect(action?.stagesRerun).toEqual([
      'conceptual_segmentation',
      'reshaping_plan',
      'generation',
    ])
    expect(result.segmentation).toEqual(newSegmentation)
    expect(result.report.outcome).toBe('repaired')
  })
})
