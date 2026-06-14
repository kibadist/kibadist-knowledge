import {
  type Prisma,
  SourceBlockImportance,
  SourceBlockPlacement,
  TransformedArticleStatus,
  TransformerBlockClass,
} from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'
import { AiService } from '../ai/ai.service'
import { PrismaService } from '../prisma/prisma.service'
import { toArticleV2 } from './article-compat.util'
import { ArticleEnrichmentService } from './article-enrichment.service'
import type { ArticleGenerationContext } from './article-generation-router'
import { ArticleGeneratorService } from './article-generator.service'
import {
  type ArticleGateResult,
  buildArticleQualityReport,
  evaluateQualityGates,
  importantCoverageScore,
  isBlockedStatus,
} from './article-quality-gate'
import {
  ArticleRegenerationService,
  type RepairResult,
} from './article-regeneration.service'
import { CalloutGeneratorService } from './callout-generator.service'
import { placeCallouts } from './callout-placement.util'
import { ClaimExtractorService } from './claim-extractor.service'
import { ConceptualSegmentationService } from './conceptual-segmentation.service'
import { buildCoverageReport, type CoverageBlock } from './coverage.util'
import { EditorialLayoutService } from './editorial-layout.service'
import { FidelityCheckerService } from './fidelity-checker.service'
import { FidelityReviewService } from './fidelity-review.service'
import { isBlockedByReview } from './fidelity-review.util'
import { IllustrationPlannerService } from './illustration-planner.service'
import { LearningLayerService } from './learning-layer.service'
import { LearningOutlineService } from './learning-outline.service'
import { deriveLearningShape, deriveSourceKind } from './learning-outline.util'
import type { PromptConceptCandidate } from './learning-prompts.prompt'
import { LearningPromptsService } from './learning-prompts.service'
import { buildReadingAids } from './reading-aids.util'
import { ReshapingPlanService } from './reshaping-plan.service'
import type {
  ArticleConceptCandidate,
  ArticleEnrichment,
  IllustrationPlan,
  IllustrationSuggestion,
  LearningConceptCandidate,
  LearningLayer,
  LearningPromptSet,
  ReshapingPlan,
  SourceStructureModel,
} from './schemas'
import { SourceDiagnosisService } from './source-diagnosis.service'
import type {
  SourceDiagnosis,
  SourceDiagnosisMetadata,
  SourceKind,
} from './source-diagnosis.types'
import { buildSourceNotes } from './source-notes.util'
import { buildSourceSegments } from './source-segments.util'
import type { ClassifiedBlockInput } from './structure-model.service'
import { StructureModelService } from './structure-model.service'
import { TableGeneratorService } from './table-generator.service'
import { ILLUSTRATION_IMAGE_SIZE } from './transformer.constants'
import {
  ARTICLE_SCHEMA_VERSION,
  type ArticleComparisonTable,
  type ArticleGeneratedCallout,
  type ArticleJsonV2,
  type ArticleQualityReportV3,
  type ConceptualSegmentation,
  type CoverageReport,
  type EditorialLayout,
  type FidelityFinding,
  type FidelityReport,
  type KeyClaim,
  type RegenerationReport,
  type SourcePreservingArticle,
} from './transformer.types'
import { ArticlePipelineV3Service } from './v3/article-pipeline-v3.service'
import type { V3AssemblyMeta } from './v3/v3-assembly.util'
import { isReadableStatusV3 } from './v3/v3-contract'
import type { V3GeneratorBlock } from './v3/v3-generator.service'

/** A loaded source block with everything the M2/M3 services need. `important`
 *  flags a HIGH-importance block (DET-346 role classifier) for the DET-355
 *  important-source-coverage gate. */
type LoadedBlock = ClassifiedBlockInput & {
  uncertain: boolean
  important: boolean
}

/**
 * Per-job generation options (DET-362). `internalPreview` marks an internal preview
 * run, which the router may route to v3 while the rollout is still preview-only.
 */
export interface ArticleGenerationOptions {
  internalPreview?: boolean
}

/** Cap auto-rendered illustrations per article to bound gpt-image-1 cost/latency
 *  (DET-319). High-fidelity-risk suggestions are never auto-rendered. */
const MAX_AUTO_ILLUSTRATIONS = 3

/**
 * Article pipeline (DET-251…255, steps 6–9). Given a READY source it creates a
 * TransformedArticle pinned to the source's blocksVersion and drives the state
 * machine MODELING → PLANNING → GENERATING → CHECKING → FINAL/BLOCKED, persisting
 * each artifact as soon as it is produced.
 *
 * FAILED vs BLOCKED (spec §FAILED vs BLOCKED):
 *  - any thrown error (schema-invalid LLM output after retry, missing
 *    traceability, exception) ⇒ FAILED with the error message persisted.
 *  - artifacts produced but the fidelity gate rejects ⇒ BLOCKED.
 *
 * Also serves the on-demand illustration (DET-259) and learning-layer (DET-258)
 * extras, which load the article's pinned blocks and never touch articleJson.
 */
@Injectable()
export class ArticlePipelineService {
  private readonly logger = new Logger(ArticlePipelineService.name)
  /** In-process guard so one article never runs twice concurrently. */
  private readonly running = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly sourceDiagnosis: SourceDiagnosisService,
    private readonly structureModel: StructureModelService,
    private readonly segmentation: ConceptualSegmentationService,
    private readonly reshapingPlan: ReshapingPlanService,
    private readonly learningOutline: LearningOutlineService,
    private readonly generator: ArticleGeneratorService,
    private readonly callouts: CalloutGeneratorService,
    private readonly tables: TableGeneratorService,
    private readonly fidelity: FidelityCheckerService,
    private readonly illustrations: IllustrationPlannerService,
    private readonly enrichment: ArticleEnrichmentService,
    private readonly editorialLayout: EditorialLayoutService,
    private readonly learning: LearningLayerService,
    private readonly learningPrompts: LearningPromptsService,
    private readonly regeneration: ArticleRegenerationService,
    private readonly fidelityReview: FidelityReviewService,
    private readonly claims: ClaimExtractorService,
    private readonly ai: AiService,
    private readonly pipelineV3: ArticlePipelineV3Service,
  ) {}

  /**
   * Create a fresh article for a READY source and run the full pipeline. Returns
   * the new article id. Fire-and-forget the returned promise; failures are
   * persisted onto the article, never thrown to the caller.
   *
   * `options.internalPreview` marks the job as an internal preview so it can route
   * to v3 while the rollout is still in internal-preview-only mode (DET-362).
   */
  async createAndRun(
    sourceId: string,
    options: ArticleGenerationOptions = {},
  ): Promise<string> {
    const source = await this.prisma.transformerSource.findUnique({
      where: { id: sourceId },
      select: { id: true, workspaceId: true, blocksVersion: true },
    })
    if (!source) throw new Error(`Source ${sourceId} not found`)

    const article = await this.prisma.transformedArticle.create({
      data: {
        sourceId: source.id,
        workspaceId: source.workspaceId,
        blocksVersion: source.blocksVersion,
        status: TransformedArticleStatus.QUEUED,
      },
      select: { id: true },
    })

    void this.run(article.id, source.id, source.blocksVersion, options).catch(
      (error) => {
        this.logger.error(
          `Article pipeline promise rejected for ${article.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      },
    )
    return article.id
  }

  /** Run steps 6–9 for an existing article. Never throws; persists FAILED/BLOCKED/FINAL. */
  async run(
    articleId: string,
    sourceId: string,
    blocksVersion: number,
    options: ArticleGenerationOptions = {},
  ): Promise<void> {
    if (this.running.has(articleId)) {
      this.logger.warn(`Article ${articleId} already running; skip.`)
      return
    }
    this.running.add(articleId)
    try {
      await this.runInner(articleId, sourceId, blocksVersion, options)
    } catch (error) {
      // FAILED = could not produce valid artifacts (schema/traceability/exception).
      const message = error instanceof Error ? error.message : 'pipeline failed'
      this.logger.error(`Article ${articleId} FAILED: ${message}`)
      await this.fail(articleId, message)
    } finally {
      this.running.delete(articleId)
    }
  }

  private async runInner(
    articleId: string,
    sourceId: string,
    blocksVersion: number,
    options: ArticleGenerationOptions = {},
  ): Promise<void> {
    const blocks = await this.loadBlocks(sourceId, blocksVersion)
    if (blocks.length === 0) {
      throw new Error('Source has no blocks at the pinned version')
    }

    // --- 5b. Source diagnosis + generation routing (DET-345 / DET-362) ------
    // Deterministic, no LLM: detect the SourceKind and select the v3 ArticleShape
    // BEFORE any prompt is built, then store the diagnosis on the job. The router
    // decides v2 (default) vs v3 (master + per-kind + internal-preview flags via the
    // dedicated article-generation-router). When it routes to v3 (DET-343), the
    // source-grounded learning pipeline runs INSTEAD of the v2 stages below and
    // persists its own learning-first articleJson; otherwise every article runs the
    // v2 pipeline as before. If a v3 job throws and the decision carries
    // `fallbackToV2OnFailure`, the job falls back to the v2 pipeline rather than
    // failing the article (DET-362). Never fatal: a diagnosis failure logs and leaves
    // the article on the conservative v2 path.
    const meta = await this.loadSourceMeta(sourceId)
    const routing = this.tryDiagnose(articleId, blocks, meta, {
      internalPreview: options.internalPreview === true,
    })
    if (routing) {
      await this.persist(articleId, {
        sourceDiagnosis: routing.diagnosis as unknown as Prisma.InputJsonValue,
      })
      this.logger.log(
        `Article ${articleId} routing → ${routing.pipeline} (${routing.reason}); v2-fallback-on-failure=${routing.fallbackToV2OnFailure}`,
      )
    }
    if (routing?.pipeline === 'v3') {
      try {
        await this.runV3(articleId, sourceId, blocks, routing.diagnosis, meta)
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Acceptance criterion (DET-362): "Failed v3 jobs can fall back to v2
        // only when explicitly configured." With the fallback flag OFF, a v3
        // failure propagates to `run`, which marks the article FAILED exactly
        // like a v2 failure. With it ON, the job re-runs on the frozen v2
        // pipeline below instead of failing — the safety net while v3 is still
        // proving out against the regression fixtures.
        if (!routing.fallbackToV2OnFailure) throw error
        this.logger.warn(
          `Article ${articleId} v3 pipeline failed (${message}); falling back to v2 per ARTICLE_GENERATION_V3_FALLBACK_TO_V2`,
        )
        // fall through to the v2 stages below (a full, fresh v2 generation).
      }
    }

    // --- 6. Structure model -------------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.MODELING)
    const structureModel = await this.structureModel.build(blocks)
    await this.persist(articleId, {
      structureModel: structureModel as unknown as Prisma.InputJsonValue,
    })

    // --- 6b. Conceptual segmentation (DET-347) ------------------------------
    // Group the classified blocks into ordered learning segments BEFORE the
    // outline, so the reshaping plan builds sections from whole concepts instead
    // of isolated blocks (which turned transcripts into fragment lists). Runs
    // within the MODELING phase (no new status enum). Best-effort: a failure
    // degrades to no-segmentation and the outline still runs exactly as before —
    // segmentation is an optional input to the plan, never a hard gate.
    const segments = await this.trySegment(articleId, structureModel, blocks)

    // --- 7. Reshaping plan --------------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.PLANNING)
    const plan = await this.reshapingPlan.build(
      structureModel,
      blocks,
      segments,
    )
    await this.persist(articleId, {
      reshapingPlan: plan as unknown as Prisma.InputJsonValue,
    })

    // --- 7b. Learning-first outline (DET-348) -------------------------------
    // Build a LEARNING structure over the same blocks — a teaching arc, concept-led
    // sections, source furniture (references/bibliography/external links) demoted to
    // source notes — and persist it. It is handed to the rewrite (generator) so the
    // article follows the learning outline rather than cloning the source layout.
    const sourceSegments = buildSourceSegments(blocks)
    const sourceKind = deriveSourceKind(blocks)
    const outline = await this.learningOutline.build({
      sourceKind,
      articleShape: deriveLearningShape(sourceKind, plan.shape),
      blocks,
      segments: sourceSegments,
    })
    await this.persist(articleId, {
      learningOutline: outline as unknown as Prisma.InputJsonValue,
    })

    // --- 8. Article generation ----------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.GENERATING)
    const generated = await this.generator.generate(plan, blocks, outline)
    // Inline callout placement (DET-272) is deterministic, computed in code (no
    // LLM): place the end-matter (keyTerms/examples/caveats) against the sections
    // by source-block overlap and attach it to the stored artifact. The top-level
    // arrays remain the single source of truth — these are placement REFERENCES.
    const placement = placeCallouts(generated)
    // Source-grounded extras (DET-350), attached BEFORE the fidelity check so the
    // checker rejects any unsupported callout/table:
    //  - generated callouts + comparison tables are LLM lanes, best-effort (a
    //    failure yields none and the article still finalizes); their own code
    //    guards keep every surviving item grounded.
    //  - source notes (references / bibliography / external links / removed
    //    navigation / low-importance) are DETERMINISTIC from the blocks, so they
    //    move out of the article body by default with no hallucination risk.
    // These enrich the v2 article (every field is optional on ArticleJsonV2); the
    // article stays schemaVersion 'v2' and renders through the Compendium. The
    // 'v3' schemaVersion + mode is RESERVED for the learning-first
    // Source-Grounded Learning Article (DET-343, see `runV3` / `v3/v3-contract.ts`)
    // so the reader's `isArticleJsonV3` dispatch never mis-routes an enriched v2
    // article into the v3 learning reader.
    const generatedCallouts = await this.tryCallouts(
      articleId,
      generated,
      blocks,
    )
    const generatedTables = await this.tryTables(articleId, generated, blocks)
    const withExtras: ArticleJsonV2 = {
      ...generated,
      schemaVersion: ARTICLE_SCHEMA_VERSION,
      calloutPlacements: {
        ...placement,
        ...(generatedCallouts.length > 0
          ? { generated: generatedCallouts }
          : {}),
      },
      tables: generatedTables,
      sourceNotes: buildSourceNotes(blocks),
    }
    // Reading aids (DET-274) are deterministic too (TOC + reading time +
    // source-grounded highlights drawn from the structure model's preserved
    // claims). They are attached HERE, before the fidelity check runs, so the
    // checker validates the highlights as traceable fragments on the enriched
    // artifact.
    const withAids: ArticleJsonV2 = {
      ...withExtras,
      readingAids: buildReadingAids(withExtras, structureModel),
    }
    // Key claims (DET-352) — the v3 claims layer. Extracted HERE, after the
    // article is rewritten and BEFORE the fidelity check, so the extracted claims
    // ride on the article the checker audits (they are available to the fidelity
    // reviewer) and downstream retrieval-prompt generation. Best-effort: a failure
    // logs and yields no claims so the article still finalizes.
    const keyClaims = await this.tryExtractClaims(articleId, withAids, blocks)
    const article: ArticleJsonV2 = {
      ...withAids,
      ...(keyClaims.length > 0 ? { keyClaims } : {}),
    }
    await this.persist(articleId, {
      articleJson: article as unknown as Prisma.InputJsonValue,
    })

    // --- 9. Fidelity + coverage ---------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.CHECKING)
    let report = await this.fidelity.check(article, structureModel, blocks)
    let coverage = this.buildCoverage(article, blocks, plan)

    // Whole-article concept extraction (DET-351). A source-grounded learning lane
    // that mints the Concept Library candidates for this article so a concept-rich
    // source never finalizes with zero (the bug this fixes). Best-effort: a failure
    // logs and yields null, and the article still finalizes without candidates. It
    // runs BEFORE the repair pass so a `missing_concepts` blocker can see the count
    // and a repair can re-extract.
    let articleConceptCandidates = await this.tryExtractArticleConcepts(
      articleId,
      article,
      blocks,
    )

    // --- 9b. Targeted regeneration (DET-356) --------------------------------
    // A rejected gate is REPAIRED rather than retried blindly: the gate findings
    // are distilled into blockers and only the implicated stage(s) are re-run, with
    // prior valid sections preserved. The pass re-checks the gate and returns the
    // (possibly improved) article + reports + a RegenerationReport recording which
    // stage was re-run and why. Best-effort: a failure leaves the original BLOCKED
    // state untouched. A repaired article reaches FINAL; a failed repair stays
    // BLOCKED with the report's clear explanation.
    let currentArticle = article
    let currentPlan = plan
    let regenerationReport: RegenerationReport | null = null
    if (!report.approved) {
      const repaired = await this.tryRepair(articleId, {
        article: currentArticle,
        structureModel,
        blocks,
        plan: currentPlan,
        fidelity: report,
        coverage,
        conceptCandidates: articleConceptCandidates,
        sourceKind: routing?.diagnosis.sourceKind ?? 'unknown',
        segmentation: segments,
      })
      if (repaired) {
        currentArticle = repaired.article
        currentPlan = repaired.plan
        report = repaired.fidelity
        coverage = repaired.coverage
        articleConceptCandidates = repaired.conceptCandidates
        regenerationReport = repaired.report
        this.logger.log(
          `Article ${articleId} repair — ${regenerationReport.outcome}: ${regenerationReport.explanation}`,
        )
      }
    }

    // --- 9b. Learning extraction (DET-258) ----------------------------------
    // The fidelity REVIEW grades concept/retrieval readiness, so the learning
    // layer must exist before it runs. Build + persist it inline here (best-effort:
    // a failure yields an empty layer so the review and finalize still proceed —
    // the on-demand `generateLearningLayer` can rebuild it later).
    const learningLayer = await this.tryLearningLayer(articleId, blocks)

    // --- 9c. Fidelity review → quality report v3 (DET-354) ------------------
    // A deterministic SYNTHESIS of the fidelity report, coverage, structure model
    // and learning layer into the v3 quality report. Its high-severity
    // `blockerReasons` are the SECOND gate on FINAL/BLOCKED: an article that
    // passes the fidelity check but, say, dropped its important source blocks or
    // carries untraceable fragments is held BLOCKED with a specific, stage-targeted
    // reason + regeneration hint.
    const reviewReport = this.fidelityReview.review({
      article: currentArticle,
      structureModel,
      blocks: blocks.map((b) => ({
        id: b.id,
        classification: b.classification,
        removable: b.removable,
      })),
      fidelityReport: report,
      coverageReport: coverage,
      learningLayer,
    })

    // --- 10. AI extras (DET-319) --------------------------------------------
    // Non-source-grounded augmentations in their own lanes (never in articleJson),
    // both best-effort. Enrichment is a fast text call, so it stays INLINE and
    // ships at the terminal status. Illustrations are slow gpt-image-1 renders —
    // running them before the terminal status kept the article in a long polled
    // CHECKING state and pressured the per-user rate limit, so they DON'T block:
    // we finalize now (article readable, the frontend stops polling) and render
    // plates in the BACKGROUND, where they appear on the learner's next fetch.
    // Both run on the (possibly repaired) article.
    const enrichment = await this.tryEnrich(articleId, currentArticle)
    // Editorial layout (the generative presentation lane) is another fast text
    // call, so it stays INLINE beside enrichment and ships at the terminal status.
    const editorialLayout = await this.tryEditorialLayout(
      articleId,
      currentArticle,
    )

    // --- 11. Quality gates + blocker status (DET-355) -----------------------
    // Grade the fidelity + coverage + concept signals against the quality
    // thresholds to decide the v3 ArticleStatus (READY_FOR_REVIEW vs a BLOCKED_*
    // held-back state) with explainable blocker reasons. The status + full quality
    // report are folded INTO the persisted article JSON, where the v3 reader's
    // status banner reads them directly. Never throws — a failure degrades to the
    // fidelity-only decision so a good article is never lost to FAILED.
    const gate = this.evaluateGate(
      articleId,
      report,
      coverage,
      blocks,
      structureModel,
      articleConceptCandidates,
      routing?.diagnosis.sourceKind ?? 'unknown',
    )
    const qualityReport = buildArticleQualityReport(
      {
        sourceCoverageScore: coverage.coveragePercent / 100,
        importantSourceCoverageScore: importantCoverageScore(
          blocks,
          coverage.representedBlockIds,
        ),
        citationCoverageScore: citationCoverage(coverage),
        unsupportedClaimCount: highSeverityCount(report.addedInformation),
        highSeverityLostInfoCount: highSeverityCount(report.lostInformation),
        conceptCandidateCount: articleConceptCandidates?.length ?? 0,
        keyClaimCount: structureModel.claims?.length ?? 0,
        retrievalPromptCount: 0,
        tableCount: generatedTables.length,
        calloutCount: generatedCallouts.length,
        // Coarse provenance proxy (source coverage stands in until a dedicated
        // provenance-completeness measure lands); readability is not yet scored.
        provenanceCompletenessScore: coverage.coveragePercent / 100,
        articleReadabilityScore: 1,
      },
      gate,
    )
    // The v3 status + quality report live in the article JSON (the v3 reader reads
    // them straight from there). The DB `status` enum keeps its coarse FINAL/BLOCKED
    // semantics so existing v2 consumers render unchanged (DET-355 criterion 6):
    // a gate-passed article is FINAL, any held-back gate is BLOCKED.
    const finalArticle = {
      ...currentArticle,
      status: gate.status,
      qualityReport,
    }
    // The DB status reflects BOTH gates: the DET-354 fidelity review (its
    // high-severity `blockerReasons` via `isBlockedByReview`) AND the DET-355
    // quality gate (`gate.status`). An article is FINAL only when the fidelity
    // check approved it, the review found no blocking issue, and every DET-355
    // learning-readiness threshold passed; otherwise it is held BLOCKED.
    const approved =
      report.approved &&
      !isBlockedByReview(reviewReport) &&
      !isBlockedStatus(gate.status)

    await this.persist(articleId, {
      // Always persist the article JSON with the DET-355 gate status + quality
      // report folded in. `finalArticle` is built from the (possibly repaired)
      // `currentArticle`, so the DET-356 repair output is what lands here. When a
      // repair ran, also record its RegenerationReport.
      articleJson: finalArticle as unknown as Prisma.InputJsonValue,
      ...(regenerationReport
        ? {
            regenerationReport:
              regenerationReport as unknown as Prisma.InputJsonValue,
          }
        : {}),
      fidelityReport: report as unknown as Prisma.InputJsonValue,
      fidelityScore: Math.round(report.fidelityScore),
      coverageReport: coverage as unknown as Prisma.InputJsonValue,
      // Persist the inline-built learning layer (DET-354 9b) with the DET-351
      // whole-article concept candidates folded in. The on-demand
      // `generateLearningLayer` carries both forward when it rebuilds the study
      // concepts, so nothing here clobbers the candidates.
      learningLayer: {
        ...learningLayer,
        ...(articleConceptCandidates ? { articleConceptCandidates } : {}),
      } as unknown as Prisma.InputJsonValue,
      // The DET-354 fidelity-review rollup lives in its own `qualityReport` column
      // (rich, severity/stage-tagged blockers) for the v2 quality panel; the DET-355
      // gate report (with `qualityReportRef` pointers) rides inside the article JSON
      // above for the v3 reader. Both quality lanes are preserved.
      qualityReport: reviewReport as unknown as Prisma.InputJsonValue,
      ...(enrichment
        ? { enrichment: enrichment as unknown as Prisma.InputJsonValue }
        : {}),
      ...(editorialLayout
        ? {
            editorialLayout:
              editorialLayout as unknown as Prisma.InputJsonValue,
          }
        : {}),
      status: approved
        ? TransformedArticleStatus.FINAL
        : TransformedArticleStatus.BLOCKED,
    })

    // Fire-and-forget: the article is already terminal and the poll has stopped.
    // Never awaited; self-contained (never throws).
    void this.illustrateInBackground(articleId, currentArticle, blocks)
  }

  /**
   * Run a targeted-regeneration repair pass (DET-356); never throws — a failure
   * logs and yields null so the article keeps its original BLOCKED state and
   * report. The service itself is internally best-effort, so this wrapper only
   * guards against an unexpected throw.
   */
  private async tryRepair(
    articleId: string,
    input: Omit<
      Parameters<ArticleRegenerationService['repair']>[0],
      'articleId'
    >,
  ): Promise<RepairResult | null> {
    try {
      return await this.regeneration.repair({ ...input, articleId })
    } catch (error) {
      this.logger.warn(
        `Targeted regeneration failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  // --- On-demand extras -----------------------------------------------------

  /** Generate + persist illustration suggestions for a FINAL/BLOCKED article. */
  async generateIllustrations(
    articleId: string,
    article: SourcePreservingArticle | ArticleJsonV2,
    sourceId: string,
    blocksVersion: number,
  ): Promise<IllustrationPlan> {
    const blocks = await this.loadBlocks(sourceId, blocksVersion)
    const plan = await this.illustrations.plan(article, blocks)
    await this.persist(articleId, {
      illustrationPlan: plan as unknown as Prisma.InputJsonValue,
    })
    return plan
  }

  // --- Claim extraction, best-effort (DET-352) ------------------------------

  /** Extract the source-grounded key claims; never throws — a failure logs and
   *  yields [] so the article still finalizes without the v3 claims layer. */
  private async tryExtractClaims(
    articleId: string,
    article: ArticleJsonV2,
    blocks: LoadedBlock[],
  ): Promise<KeyClaim[]> {
    try {
      return await this.claims.extract(article, blocks)
    } catch (error) {
      this.logger.warn(
        `Claim extraction failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }

  // --- Source-grounded extras, best-effort (DET-350) ------------------------

  /** Generate source-grounded callouts; never throws — a failure logs and yields
   *  none so the article still finalizes. Surviving callouts are grounded by the
   *  service's own guards and re-verified by the fidelity checker. */
  private async tryCallouts(
    articleId: string,
    article: ArticleJsonV2,
    blocks: ClassifiedBlockInput[],
  ): Promise<ArticleGeneratedCallout[]> {
    try {
      return await this.callouts.generate(article, blocks)
    } catch (error) {
      this.logger.warn(
        `Callout generation failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }

  /** Generate source-grounded comparison tables; never throws — a failure logs and
   *  yields none. Surviving tables are grounded by the service's guards and
   *  re-verified by the fidelity checker. */
  private async tryTables(
    articleId: string,
    article: ArticleJsonV2,
    blocks: ClassifiedBlockInput[],
  ): Promise<ArticleComparisonTable[]> {
    try {
      return await this.tables.generate(article, blocks)
    } catch (error) {
      this.logger.warn(
        `Table generation failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }

  // --- Conceptual segmentation, best-effort (DET-347) -----------------------

  /**
   * Build + persist the conceptual segmentation; never throws — a failure logs and
   * yields null so the outline still runs (degraded to no-segmentation, exactly as
   * the pipeline behaved before DET-347). On success the segment→block mapping is
   * persisted onto `segments` and returned so the reshaping plan can consume it.
   */
  private async trySegment(
    articleId: string,
    structureModel: SourceStructureModel,
    blocks: LoadedBlock[],
  ): Promise<ConceptualSegmentation | null> {
    try {
      const segmentation = await this.segmentation.segment(
        structureModel,
        blocks,
      )
      await this.persist(articleId, {
        segments: segmentation as unknown as Prisma.InputJsonValue,
      })
      return segmentation
    } catch (error) {
      this.logger.warn(
        `Conceptual segmentation failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  // --- AI extras, best-effort (DET-319) -------------------------------------

  /** Build enrichment; never throws — a failure logs and yields null so the
   *  article still finalizes without the AI headword metadata. */
  private async tryEnrich(
    articleId: string,
    article: ArticleJsonV2,
  ): Promise<ArticleEnrichment | null> {
    try {
      return await this.enrichment.build(article)
    } catch (error) {
      this.logger.warn(
        `Enrichment failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  /** Build the learning layer inline; never throws — a failure logs and yields an
   *  EMPTY layer so the fidelity review (which grades concept/retrieval readiness)
   *  and the finalize still proceed. The on-demand path can rebuild it later. */
  private async tryLearningLayer(
    articleId: string,
    blocks: LoadedBlock[],
  ): Promise<LearningLayer> {
    try {
      return await this.learning.build(blocks)
    } catch (error) {
      this.logger.warn(
        `Learning extraction failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return { concepts: [], retrievalPrompts: [] }
    }
  }

  /** Build the editorial layout; never throws — a failure logs and yields null so
   *  the article still finalizes (the web renderer has a deterministic fallback). */
  private async tryEditorialLayout(
    articleId: string,
    article: ArticleJsonV2,
  ): Promise<EditorialLayout | null> {
    try {
      return await this.editorialLayout.build(article)
    } catch (error) {
      this.logger.warn(
        `Editorial layout failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  /**
   * Extract the whole-article concept candidates (DET-351); never throws — a
   * failure logs and yields null so the article still finalizes without them.
   * Returns the candidate list (possibly empty) on success, null on failure, so
   * the caller can tell "ran, found none" from "did not run".
   */
  private async tryExtractArticleConcepts(
    articleId: string,
    article: ArticleJsonV2,
    blocks: LoadedBlock[],
  ): Promise<ArticleConceptCandidate[] | null> {
    try {
      return await this.learning.extractArticleConcepts(article, blocks)
    } catch (error) {
      this.logger.warn(
        `Concept extraction failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  /**
   * Plan + auto-render illustrations AFTER the article is terminal, then persist
   * the plan. Fire-and-forget from the pipeline (the article is already
   * FINAL/BLOCKED), so it's fully self-contained and never throws — a planning
   * failure yields no plates, a render failure degrades a single plate, and the
   * persist itself is guarded. Plates surface on the learner's next fetch.
   */
  private async illustrateInBackground(
    articleId: string,
    article: ArticleJsonV2,
    blocks: LoadedBlock[],
  ): Promise<void> {
    try {
      const plan = await this.illustrations.plan(article, blocks)
      const suggestions = await this.autoRenderEligible(
        articleId,
        plan.suggestions,
      )
      await this.persist(articleId, {
        illustrationPlan: { suggestions } as unknown as Prisma.InputJsonValue,
      })
    } catch (error) {
      this.logger.warn(
        `Background illustrations failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Auto-render the eligible suggestions into images. Eligible = NOT high
   * fidelityRisk (the planner already forces source_based_diagram to high unless
   * every cited block is METHOD), capped at MAX_AUTO_ILLUSTRATIONS. A rendered
   * suggestion is marked `approved` with its `image` metadata; the rest stay
   * `pending` (the manual approve→render path is unchanged). One render failure
   * leaves that suggestion pending and continues.
   */
  private async autoRenderEligible(
    articleId: string,
    suggestions: IllustrationSuggestion[],
  ): Promise<IllustrationSuggestion[]> {
    const out: IllustrationSuggestion[] = []
    let rendered = 0
    for (const s of suggestions) {
      if (rendered >= MAX_AUTO_ILLUSTRATIONS || s.fidelityRisk === 'high') {
        out.push(s)
        continue
      }
      try {
        const image = await this.renderSuggestionImage(articleId, s)
        out.push({ ...s, approval: 'approved', image })
        rendered++
      } catch (error) {
        this.logger.warn(
          `Auto-render failed for suggestion ${s.id} (${articleId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        out.push(s)
      }
    }
    return out
  }

  /**
   * Render one suggestion into a stored PNG (mirrors the on-demand render in
   * TransformerService). The prompt uses ONLY the suggestion's own text
   * (visualDescription + caption), never the source blocks. Bytes are upserted
   * into TransformerIllustrationImage; the returned metadata is patched onto the
   * suggestion by the caller.
   */
  private async renderSuggestionImage(
    articleId: string,
    suggestion: IllustrationSuggestion,
  ): Promise<NonNullable<IllustrationSuggestion['image']>> {
    const prompt = `${suggestion.visualDescription}\n\nCaption: ${suggestion.caption}`
    const result = await this.ai.image({
      prompt,
      size: ILLUSTRATION_IMAGE_SIZE,
    })
    const bytes = new Uint8Array(Buffer.from(result.base64, 'base64'))
    const imageRow = {
      data: bytes,
      mediaType: result.mediaType,
      width: result.width,
      height: result.height,
      provider: this.ai.providerName,
      model: result.model,
      prompt,
    }
    await this.prisma.transformerIllustrationImage.upsert({
      where: {
        articleId_suggestionId: { articleId, suggestionId: suggestion.id },
      },
      create: { articleId, suggestionId: suggestion.id, ...imageRow },
      update: imageRow,
    })
    return {
      width: result.width,
      height: result.height,
      provider: this.ai.providerName,
      model: result.model,
      generatedAt: new Date().toISOString(),
    }
  }

  /**
   * Generate + persist the DET-258 study layer (concepts + retrieval prompts) for
   * an article on demand (never touches articleJson). The article's DET-283
   * per-section candidates and DET-351 whole-article candidates live in the SAME
   * learningLayer JSON column, so we read the existing row and carry them forward —
   * regenerating the study concepts must never wipe the extracted candidates.
   * The article's key claims (DET-352), when present, are passed as retrieval-prompt
   * seeds so the generated self-test prompts target the article's important claims.
   */
  async generateLearningLayer(
    articleId: string,
    sourceId: string,
    blocksVersion: number,
    keyClaims: KeyClaim[] = [],
  ): Promise<LearningLayer> {
    const blocks = await this.loadBlocks(sourceId, blocksVersion)
    const built = await this.learning.build(blocks, keyClaims)
    const existing = await this.prisma.transformedArticle.findUnique({
      where: { id: articleId },
      select: { learningLayer: true, articleJson: true, structureModel: true },
    })
    const prior = (existing?.learningLayer as LearningLayer | null) ?? null
    const layer: LearningLayer = {
      ...built,
      ...(prior?.conceptCandidates
        ? { conceptCandidates: prior.conceptCandidates }
        : {}),
      ...(prior?.articleConceptCandidates
        ? { articleConceptCandidates: prior.articleConceptCandidates }
        : {}),
    }

    // Learning prompts + misconceptions (DET-353): an additive source-grounded
    // study lane that consumes the generated article (sections/source examples/
    // callouts), the prior concept candidates, and the structure model's key
    // claims. Best-effort — a failure leaves the DET-258 layer intact and only
    // logs. NOTHING here schedules a permanent review card: every prompt starts
    // `ai_suggested` and is only promoted when the learner validates/answers it.
    const promptSet = await this.tryBuildLearningPrompts(
      articleId,
      existing?.articleJson as
        | SourcePreservingArticle
        | ArticleJsonV2
        | null
        | undefined,
      existing?.structureModel as SourceStructureModel | null | undefined,
      prior,
      blocks,
    )
    if (promptSet) {
      layer.retrievalPromptCandidates = promptSet.retrievalPrompts
      layer.misconceptions = promptSet.misconceptions
    }

    await this.persist(articleId, {
      learningLayer: layer as unknown as Prisma.InputJsonValue,
    })
    return layer
  }

  /**
   * Build the DET-353 retrieval-prompt + misconception set for an article; never
   * throws — a failure (or a missing/ungenerated article) logs and yields null so
   * the DET-258 learning layer still persists. Concept candidates are drawn from
   * BOTH the DET-283 per-section candidates and the DET-351 whole-article
   * candidates (normalized to id/label/definition); key claims come from the stored
   * structure model.
   */
  private async tryBuildLearningPrompts(
    articleId: string,
    articleJson: SourcePreservingArticle | ArticleJsonV2 | null | undefined,
    structureModel: SourceStructureModel | null | undefined,
    prior: LearningLayer | null,
    blocks: LoadedBlock[],
  ): Promise<LearningPromptSet | null> {
    if (!articleJson) return null
    try {
      const article = toArticleV2(articleJson)
      const conceptCandidates: PromptConceptCandidate[] = [
        ...(prior?.conceptCandidates ?? []).map((c) => ({
          id: c.id,
          label: c.label,
          definition: c.definition,
        })),
        ...(prior?.articleConceptCandidates ?? []).map((c) => ({
          id: c.id,
          label: c.name,
          definition: c.shortDefinition ?? c.name,
        })),
      ]
      const keyClaims = (structureModel?.claims ?? []).map((c) => ({
        text: c.text,
        sourceBlockIds: c.sourceBlockIds,
      }))
      return await this.learningPrompts.build({
        article,
        blocks,
        conceptCandidates,
        keyClaims,
      })
    } catch (error) {
      this.logger.warn(
        `Learning prompts failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  /**
   * Extract concept candidates for one section of an article (DET-283). Loads the
   * article's PINNED blocks and delegates the scoping + grounding + code guards to
   * the learning-layer service; persistence (under the per-article row lock) is
   * the caller's job — this never touches articleJson or learningLayer.
   */
  async extractSectionConcepts(
    article: ArticleJsonV2,
    sectionId: string,
    sourceId: string,
    blocksVersion: number,
  ): Promise<LearningConceptCandidate[]> {
    const blocks = await this.loadBlocks(sourceId, blocksVersion)
    return this.learning.extractCandidatesForSection(article, sectionId, blocks)
  }

  // --- helpers --------------------------------------------------------------

  private buildCoverage(
    article: SourcePreservingArticle | ArticleJsonV2,
    blocks: LoadedBlock[],
    plan: ReshapingPlan,
  ): CoverageReport {
    const coverageBlocks: CoverageBlock[] = blocks.map((b) => ({
      id: b.id,
      uncertain: b.uncertain,
    }))
    return buildCoverageReport(article, coverageBlocks, plan.removedBlocks)
  }

  /**
   * Evaluate the DET-355 quality gates over the post-fidelity signals. Never
   * throws — any failure degrades to the fidelity-only decision (READY_FOR_REVIEW
   * when fidelity approved, BLOCKED_FIDELITY otherwise) so a good article is never
   * lost to FAILED by a gate bug.
   */
  private evaluateGate(
    articleId: string,
    report: FidelityReport,
    coverage: CoverageReport,
    blocks: LoadedBlock[],
    structureModel: SourceStructureModel,
    candidates: ArticleConceptCandidate[] | null,
    sourceKind: SourceKind,
  ): ArticleGateResult {
    try {
      return evaluateQualityGates({
        sourceKind,
        conceptRich: isConceptRichKind(sourceKind),
        fidelityApproved: report.approved,
        importantSourceCoverageScore: importantCoverageScore(
          blocks,
          coverage.representedBlockIds,
        ),
        unsupportedClaimCount: highSeverityCount(report.addedInformation),
        conceptCandidateCount: candidates?.length ?? 0,
        highSeverityLostInfoCount: highSeverityCount(report.lostInformation),
      })
    } catch (error) {
      this.logger.warn(
        `Quality gate evaluation failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return {
        status: report.approved ? 'READY_FOR_REVIEW' : 'BLOCKED_FIDELITY',
        blockerReasons: [],
        regenerationHints: [],
      }
    }
  }

  /**
   * Run the source diagnosis + routing decision; never throws. A failure logs and
   * yields null so the article still runs the v2 pipeline (the conservative path).
   */
  private tryDiagnose(
    articleId: string,
    blocks: LoadedBlock[],
    meta: SourceDiagnosisMetadata,
    context: ArticleGenerationContext = {},
  ): ReturnType<SourceDiagnosisService['route']> | null {
    try {
      return this.sourceDiagnosis.route(blocks, meta, context)
    } catch (error) {
      this.logger.warn(
        `Source diagnosis failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  /** Load the detection-relevant metadata projection for a source. */
  private async loadSourceMeta(
    sourceId: string,
  ): Promise<SourceDiagnosisMetadata> {
    const source = await this.prisma.transformerSource.findUnique({
      where: { id: sourceId },
      select: { type: true, url: true, fileName: true, metadata: true },
    })
    if (!source) return {}
    const pageCount =
      source.metadata &&
      typeof source.metadata === 'object' &&
      !Array.isArray(source.metadata) &&
      typeof (source.metadata as { pageCount?: unknown }).pageCount === 'number'
        ? (source.metadata as { pageCount: number }).pageCount
        : null
    return {
      sourceType: source.type,
      url: source.url,
      fileName: source.fileName,
      pageCount,
    }
  }

  /** Load the pinned-version blocks for a source as M2/M3 inputs. */
  async loadBlocks(
    sourceId: string,
    blocksVersion: number,
  ): Promise<LoadedBlock[]> {
    const rows = await this.prisma.transformerSourceBlock.findMany({
      where: { sourceId, version: blocksVersion },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        blockType: true,
        text: true,
        headingLevel: true,
        classification: true,
        removable: true,
        placement: true,
        importance: true,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      type: r.blockType,
      classification: r.classification ?? TransformerBlockClass.UNCERTAIN,
      text: r.text,
      headingLevel: r.headingLevel,
      // HIGH-importance blocks anchor the DET-355 important-source-coverage gate;
      // null/MEDIUM/LOW (and un-role-classified rows) are not "important".
      important: r.importance === SourceBlockImportance.HIGH,
      // Main-body generation ignores filler/navigation/reference clutter by
      // default (DET-346): a block is excluded from the body when the noise
      // classifier marked it removable OR the role classifier recommends it be
      // discarded / moved to source notes. SOURCE_NOTES blocks (references,
      // bibliography, external links) are kept in the DB with their placement
      // for the fidelity/source-notes lane — they just don't enter the prose.
      removable: r.removable || excludedFromMainBody(r.placement),
      uncertain:
        r.classification === TransformerBlockClass.UNCERTAIN ||
        !r.classification,
    }))
  }

  // --- v3 source-grounded learning pipeline (DET-343) -----------------------

  /**
   * Run the v3 Source-Grounded Learning Article pipeline for a source the router
   * sent to v3. Generates the learning-first article (`v3/v3-contract.ts`), reads
   * the baked-in quality-gate verdict, and persists the result into the SAME
   * `articleJson` column the v2 path uses — discriminated on `schemaVersion: 'v3'`
   * + `mode`, so the reader dispatches it to the learning-first reader (DET-357)
   * while v2 articles keep rendering through the Compendium.
   *
   * The row status maps the v3 status onto the existing enum: a readable article
   * (READY_FOR_REVIEW/FINAL) ⇒ FINAL; any held-back status (blocked/needs-regen)
   * ⇒ BLOCKED. An LLM/infra failure propagates to `run`, which marks the row
   * FAILED — exactly like the v2 path.
   */
  private async runV3(
    articleId: string,
    sourceId: string,
    blocks: LoadedBlock[],
    diagnosis: SourceDiagnosis,
    meta: SourceDiagnosisMetadata,
  ): Promise<void> {
    await this.setStatus(articleId, TransformedArticleStatus.GENERATING)

    const genBlocks: V3GeneratorBlock[] = blocks.map((b) => ({
      id: b.id,
      blockType: b.type,
      classification: b.classification,
      removable: b.removable,
      text: b.text,
    }))
    const captureMethod =
      meta.sourceType === 'URL'
        ? 'URL'
        : meta.sourceType === 'PDF'
          ? 'PDF'
          : 'PASTE'
    const assemblyMeta: V3AssemblyMeta = {
      sourceKind: diagnosis.sourceKind,
      shape: diagnosis.articleShape ?? 'concept_explainer',
      sourceId,
      sourceUrl: meta.url ?? null,
      captureMethod,
    }

    const article = await this.pipelineV3.run(genBlocks, assemblyMeta)
    article.generatedAt = new Date().toISOString()

    await this.persist(articleId, {
      articleJson: article as unknown as Prisma.InputJsonValue,
      status: isReadableStatusV3(article.status)
        ? TransformedArticleStatus.FINAL
        : TransformedArticleStatus.BLOCKED,
    })
    this.logger.log(
      `Article ${articleId} v3 ${article.status} (important coverage ${article.qualityReport.importantSourceCoverageScore}%, ${article.qualityReport.conceptCandidateCount} concepts)`,
    )
  }

  private setStatus(
    articleId: string,
    status: TransformedArticleStatus,
  ): Promise<unknown> {
    return this.prisma.transformedArticle.update({
      where: { id: articleId },
      data: { status },
    })
  }

  private persist(
    articleId: string,
    data: Prisma.TransformedArticleUpdateInput,
  ): Promise<unknown> {
    return this.prisma.transformedArticle.update({
      where: { id: articleId },
      data,
    })
  }

  private async fail(articleId: string, message: string): Promise<void> {
    try {
      await this.prisma.transformedArticle.update({
        where: { id: articleId },
        data: { status: TransformedArticleStatus.FAILED, error: message },
      })
    } catch (error) {
      this.logger.error(
        `Failed to persist FAILED for article ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

/**
 * Whether a role classifier placement (DET-346) keeps a block OUT of the main
 * body: DISCARD (filler/navigation) and SOURCE_NOTES (references, bibliography,
 * external links) are both excluded from the generated prose. MAIN_BODY /
 * CALLOUT and a null placement (un-role-classified) keep the block in play.
 */
function excludedFromMainBody(placement: SourceBlockPlacement | null): boolean {
  return (
    placement === SourceBlockPlacement.DISCARD ||
    placement === SourceBlockPlacement.SOURCE_NOTES
  )
}

/** Count the high-severity findings in a fidelity finding list (DET-355). */
function highSeverityCount(findings: FidelityFinding[]): number {
  return findings.filter((f) => f.severity === 'high').length
}

/**
 * Fraction of mapped article paragraphs/blocks that cite at least one source
 * block (DET-355 `citationCoverageScore`). 1 when the article has no mapped body
 * (nothing to cite). Derived from the deterministic coverage report's paragraphMap.
 */
function citationCoverage(coverage: CoverageReport): number {
  const mapped = coverage.paragraphMap
  if (mapped.length === 0) return 1
  const cited = mapped.filter((p) => p.sourceBlockIds.length > 0).length
  return cited / mapped.length
}

/**
 * Whether a source kind is "concept-rich" — i.e. the missing-concepts gate
 * applies (DET-355 acceptance criterion 4). Teachable kinds (lessons, structured
 * articles, papers, docs) are concept-rich; raw notes / unknown sources are not,
 * so a thin source is never blocked for having too few concepts.
 */
function isConceptRichKind(sourceKind: SourceKind): boolean {
  return (
    sourceKind === 'transcript_lesson' ||
    sourceKind === 'structured_web_article' ||
    sourceKind === 'research_paper' ||
    sourceKind === 'documentation'
  )
}
