import { Injectable, Logger } from '@nestjs/common'

import {
  deriveBlockers,
  highImportanceUnrepresented,
} from './article-blockers.util'
import { ArticleGeneratorService } from './article-generator.service'
import {
  preserveValidSections,
  removeUnsupportedClaims,
  strategyFor,
} from './article-regeneration.util'
import { ConceptualSegmentationService } from './conceptual-segmentation.service'
import { buildCoverageReport, type CoverageBlock } from './coverage.util'
import { FidelityCheckerService } from './fidelity-checker.service'
import { LearningLayerService } from './learning-layer.service'
import { ReshapingPlanService } from './reshaping-plan.service'
import type {
  ArticleConceptCandidate,
  ReshapingPlan,
  SourceStructureModel,
} from './schemas'
import type { SourceKind } from './source-diagnosis.types'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleBlocker,
  ArticleJsonV2,
  ConceptualSegmentation,
  CoverageReport,
  FidelityReport,
  RegenerationAction,
  RegenerationReport,
} from './transformer.types'

/** A loaded block carries the `uncertain` flag the coverage report needs. */
type RepairBlock = ClassifiedBlockInput & { uncertain: boolean }

/** The full state of a blocked generation handed to the repair pass (DET-356). */
export interface RepairInput {
  /** For logging only. */
  articleId?: string
  article: ArticleJsonV2
  structureModel: SourceStructureModel
  blocks: RepairBlock[]
  plan: ReshapingPlan
  fidelity: FidelityReport
  coverage: CoverageReport
  /** Concept candidates extracted, or null when extraction never ran. */
  conceptCandidates: ArticleConceptCandidate[] | null
  sourceKind: SourceKind
  segmentation: ConceptualSegmentation | null
}

/** The repaired (or unchanged) state plus the audit of what the pass did. */
export interface RepairResult {
  report: RegenerationReport
  article: ArticleJsonV2
  fidelity: FidelityReport
  coverage: CoverageReport
  conceptCandidates: ArticleConceptCandidate[] | null
  plan: ReshapingPlan
  segmentation: ConceptualSegmentation | null
}

/**
 * A fixed order so a repair pass is deterministic and the cheap, in-place fixes
 * run before the expensive re-generation ones. Coherence first (it re-segments
 * and regenerates the whole article), then coverage (re-plan + regenerate),
 * then claim pruning (in-place over whatever the prior stages produced), then
 * concept extraction (over the final article).
 */
const REPAIR_ORDER: ArticleBlocker['reason'][] = [
  'poor_transcript_coherence',
  'low_coverage',
  'unsupported_claims',
  'missing_concepts',
]

/**
 * Targeted regeneration of a BLOCKED article (DET-356). Instead of retrying the
 * whole pipeline blindly, it distils the gate findings into `ArticleBlocker`s and
 * re-runs ONLY the stage(s) each blocker implicates, preserving every prior valid
 * section, then re-checks the gate. A repaired article reaches the gate; a repair
 * that fails leaves the article blocked with a clear explanation of what is still
 * wrong.
 *
 * Every stage rerun goes through the same services the main pipeline uses, so the
 * repair is exercised the same way and unit-tested by mocking those services.
 */
@Injectable()
export class ArticleRegenerationService {
  private readonly logger = new Logger(ArticleRegenerationService.name)

  constructor(
    private readonly segmentation: ConceptualSegmentationService,
    private readonly reshapingPlan: ReshapingPlanService,
    private readonly generator: ArticleGeneratorService,
    private readonly learning: LearningLayerService,
    private readonly fidelity: FidelityCheckerService,
  ) {}

  /**
   * Run a single targeted repair pass. Never throws — a stage failure degrades to
   * "this blocker was not resolved" and the pass still returns a report (the
   * caller persists BLOCKED with the explanation).
   */
  async repair(input: RepairInput): Promise<RepairResult> {
    const attemptedAt = new Date().toISOString()
    const blockersBefore = this.deriveFor(
      input.fidelity,
      input.coverage,
      input.conceptCandidates,
      input.sourceKind,
      input.segmentation,
    )

    // Nothing repairable — the gate must have approved (defensive: the pipeline
    // only calls repair on a rejected gate).
    if (blockersBefore.length === 0) {
      return this.unchanged(input, {
        attempted: false,
        outcome: 'no_blockers',
        blockersBefore: [],
        blockersAfter: [],
        actions: [],
        preservedSectionIds: input.article.sections.map((s) => s.id),
        explanation: 'No blockers detected; nothing to repair.',
        attemptedAt,
      })
    }

    let article = input.article
    let plan = input.plan
    let segmentation = input.segmentation
    let conceptCandidates = input.conceptCandidates
    const actions: RegenerationAction[] = []
    // Start by preserving every prior section; reruns subtract from this.
    const preserved = new Set(article.sections.map((s) => s.id))

    const reasons = REPAIR_ORDER.filter((r) =>
      blockersBefore.some((b) => b.reason === r),
    )
    for (const reason of reasons) {
      const strategy = strategyFor(reason)
      const blocker = blockersBefore.find((b) => b.reason === reason)
      if (!blocker) continue
      try {
        if (reason === 'unsupported_claims') {
          const { article: pruned, removedRefs } = removeUnsupportedClaims(
            article,
            blocker.evidence.articleRefs ?? [],
          )
          article = pruned
          for (const id of removedRefs) preserved.delete(id)
        } else if (reason === 'missing_concepts') {
          conceptCandidates = await this.learning.extractArticleConcepts(
            article,
            input.blocks,
          )
        } else if (reason === 'poor_transcript_coherence') {
          segmentation = await this.segmentation.segment(
            input.structureModel,
            input.blocks,
          )
          plan = await this.reshapingPlan.build(
            input.structureModel,
            input.blocks,
            segmentation,
          )
          const regenerated = await this.generator.generate(plan, input.blocks)
          // Re-segmentation rebuilds the teaching arc: every prior section may be
          // re-cut, so we replace them all with the regenerated ones.
          const merged = preserveValidSections(
            article.sections,
            regenerated.sections,
            article.sections.map((s) => s.id),
          )
          article = { ...regenerated, sections: merged.sections }
          preserved.clear()
          for (const id of merged.preservedSectionIds) preserved.add(id)
        } else if (reason === 'low_coverage') {
          plan = await this.reshapingPlan.build(
            input.structureModel,
            input.blocks,
            segmentation,
          )
          const regenerated = await this.generator.generate(plan, input.blocks)
          // Preserve prior sections; append regenerated sections that fill gaps.
          const merged = preserveValidSections(
            article.sections,
            regenerated.sections,
            [],
          )
          article = { ...article, sections: merged.sections }
          preserved.clear()
          for (const id of merged.preservedSectionIds) preserved.add(id)
        }
        actions.push({
          blockerReason: reason,
          stagesRerun: strategy.stages,
          why: strategy.why,
          // Provisional; recomputed below once the gate is re-checked.
          resolved: false,
        })
      } catch (error) {
        this.logger.warn(
          `Repair for ${reason} on ${input.articleId ?? 'article'} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        actions.push({
          blockerReason: reason,
          stagesRerun: strategy.stages,
          why: `${strategy.why} (stage failed: ${
            error instanceof Error ? error.message : String(error)
          })`,
          resolved: false,
        })
      }
    }

    // --- Re-check the gate on the repaired article ---------------------------
    const recheck = await this.recheck(
      article,
      input.structureModel,
      input.blocks,
    )
    const coverage = this.buildCoverage(article, input.blocks, plan)
    const blockersAfter = this.deriveFor(
      recheck,
      coverage,
      conceptCandidates,
      input.sourceKind,
      segmentation,
    )

    // An action resolved its blocker iff that reason no longer appears after.
    const remainingReasons = new Set(blockersAfter.map((b) => b.reason))
    for (const action of actions) {
      action.resolved = !remainingReasons.has(action.blockerReason)
    }

    const outcome = recheck.approved ? 'repaired' : 'still_blocked'
    const explanation = recheck.approved
      ? `Repaired via ${actions.length} targeted rerun(s): ${actions
          .map((a) => `${a.blockerReason} [${a.stagesRerun.join(', ')}]`)
          .join('; ')}. The gate now passes.`
      : `Still blocked after targeted repair. Remaining: ${blockersAfter
          .map((b) => `${b.reason} — ${b.explanation}`)
          .join(' | ')}`

    const report: RegenerationReport = {
      attempted: true,
      outcome,
      blockersBefore,
      blockersAfter,
      actions,
      preservedSectionIds: [...preserved],
      explanation,
      attemptedAt,
    }

    return {
      report,
      article,
      fidelity: recheck,
      coverage,
      conceptCandidates,
      plan,
      segmentation,
    }
  }

  /** Re-run the fidelity gate on a repaired article; never throws (degrades to a
   *  rejecting report so the article stays blocked rather than failing). */
  private async recheck(
    article: ArticleJsonV2,
    structureModel: SourceStructureModel,
    blocks: ClassifiedBlockInput[],
  ): Promise<FidelityReport> {
    try {
      return await this.fidelity.check(article, structureModel, blocks)
    } catch (error) {
      this.logger.warn(
        `Fidelity re-check failed during repair: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return {
        fidelityScore: 0,
        approved: false,
        addedInformation: [],
        lostInformation: [
          {
            severity: 'high',
            description: `Fidelity re-check failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        meaningChanges: [],
        unsupportedHeadings: [],
        missingCaveats: [],
        unsupportedExamples: [],
        emphasisChanges: [],
        structuralFindings: [],
      }
    }
  }

  /** Derive the blockers from a report set, computing high-importance misses. */
  private deriveFor(
    fidelity: FidelityReport,
    coverage: CoverageReport,
    conceptCandidates: ArticleConceptCandidate[] | null,
    sourceKind: SourceKind,
    segmentation: ConceptualSegmentation | null,
  ): ArticleBlocker[] {
    return deriveBlockers({
      fidelity,
      coverage,
      conceptCandidateCount: conceptCandidates?.length ?? null,
      sourceKind,
      segmentation,
      highImportanceUnrepresented: highImportanceUnrepresented(
        segmentation,
        coverage,
      ),
    })
  }

  private buildCoverage(
    article: ArticleJsonV2,
    blocks: RepairBlock[],
    plan: ReshapingPlan,
  ): CoverageReport {
    const coverageBlocks: CoverageBlock[] = blocks.map((b) => ({
      id: b.id,
      uncertain: b.uncertain,
    }))
    return buildCoverageReport(article, coverageBlocks, plan.removedBlocks)
  }

  private unchanged(
    input: RepairInput,
    report: RegenerationReport,
  ): RepairResult {
    return {
      report,
      article: input.article,
      fidelity: input.fidelity,
      coverage: input.coverage,
      conceptCandidates: input.conceptCandidates,
      plan: input.plan,
      segmentation: input.segmentation,
    }
  }
}
