import {
  type Prisma,
  SourceBlockPlacement,
  TransformedArticleStatus,
  TransformerBlockClass,
} from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'
import { AiService } from '../ai/ai.service'
import { PrismaService } from '../prisma/prisma.service'
import { toArticleV2 } from './article-compat.util'
import { ArticleEnrichmentService } from './article-enrichment.service'
import { ArticleGeneratorService } from './article-generator.service'
import { CalloutGeneratorService } from './callout-generator.service'
import { placeCallouts } from './callout-placement.util'
import { ClaimExtractorService } from './claim-extractor.service'
import { ConceptualSegmentationService } from './conceptual-segmentation.service'
import { buildCoverageReport, type CoverageBlock } from './coverage.util'
import { EditorialLayoutService } from './editorial-layout.service'
import { FidelityCheckerService } from './fidelity-checker.service'
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
  type ConceptualSegmentation,
  type CoverageReport,
  type EditorialLayout,
  type FidelityReport,
  type KeyClaim,
  type SourcePreservingArticle,
} from './transformer.types'
import { ArticlePipelineV3Service } from './v3/article-pipeline-v3.service'
import type { V3AssemblyMeta } from './v3/v3-assembly.util'
import { isReadableStatusV3 } from './v3/v3-contract'
import type { V3GeneratorBlock } from './v3/v3-generator.service'

/** A loaded source block with everything the M2/M3 services need. */
type LoadedBlock = ClassifiedBlockInput & { uncertain: boolean }

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
    private readonly claims: ClaimExtractorService,
    private readonly ai: AiService,
    private readonly pipelineV3: ArticlePipelineV3Service,
  ) {}

  /**
   * Create a fresh article for a READY source and run the full pipeline. Returns
   * the new article id. Fire-and-forget the returned promise; failures are
   * persisted onto the article, never thrown to the caller.
   */
  async createAndRun(sourceId: string): Promise<string> {
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

    void this.run(article.id, source.id, source.blocksVersion).catch(
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
  ): Promise<void> {
    if (this.running.has(articleId)) {
      this.logger.warn(`Article ${articleId} already running; skip.`)
      return
    }
    this.running.add(articleId)
    try {
      await this.runInner(articleId, sourceId, blocksVersion)
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
  ): Promise<void> {
    const blocks = await this.loadBlocks(sourceId, blocksVersion)
    if (blocks.length === 0) {
      throw new Error('Source has no blocks at the pinned version')
    }

    // --- 5b. Source diagnosis (DET-345) -------------------------------------
    // Deterministic, no LLM: detect the SourceKind and select the v3 ArticleShape
    // BEFORE any prompt is built, then store the diagnosis on the job. The router
    // decides v2 (default) vs v3 (flag + targeted-kind gated). When it routes to
    // v3 (DET-343), the source-grounded learning pipeline runs INSTEAD of the v2
    // stages below and persists its own learning-first articleJson; otherwise every
    // article runs the v2 pipeline as before. Never fatal: a diagnosis failure logs
    // and leaves the article on the conservative v2 path.
    const meta = await this.loadSourceMeta(sourceId)
    const routing = this.tryDiagnose(articleId, blocks, meta)
    if (routing) {
      await this.persist(articleId, {
        sourceDiagnosis: routing.diagnosis as unknown as Prisma.InputJsonValue,
      })
      this.logger.log(`Article ${articleId} routing — ${routing.reason}`)
    }
    if (routing?.pipeline === 'v3') {
      await this.runV3(articleId, sourceId, blocks, routing.diagnosis, meta)
      return
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
    const report = await this.fidelity.check(article, structureModel, blocks)
    const coverage = this.buildCoverage(article, blocks, plan)

    // --- 10. AI extras (DET-319) --------------------------------------------
    // Non-source-grounded augmentations in their own lanes (never in articleJson),
    // both best-effort. Enrichment is a fast text call, so it stays INLINE and
    // ships at the terminal status. Illustrations are slow gpt-image-1 renders —
    // running them before the terminal status kept the article in a long polled
    // CHECKING state and pressured the per-user rate limit, so they DON'T block:
    // we finalize now (article readable, the frontend stops polling) and render
    // plates in the BACKGROUND, where they appear on the learner's next fetch.
    const enrichment = await this.tryEnrich(articleId, article)
    // Editorial layout (the generative presentation lane) is another fast text
    // call, so it stays INLINE beside enrichment and ships at the terminal status.
    const editorialLayout = await this.tryEditorialLayout(articleId, article)
    // Whole-article concept extraction (DET-351). A source-grounded learning lane
    // that mints the Concept Library candidates for this article so a concept-rich
    // source never finalizes with zero (the bug this fixes). Best-effort: a failure
    // logs and yields null, and the article still finalizes without candidates.
    const articleConceptCandidates = await this.tryExtractArticleConcepts(
      articleId,
      article,
      blocks,
    )

    await this.persist(articleId, {
      fidelityReport: report as unknown as Prisma.InputJsonValue,
      fidelityScore: Math.round(report.fidelityScore),
      coverageReport: coverage as unknown as Prisma.InputJsonValue,
      ...(enrichment
        ? { enrichment: enrichment as unknown as Prisma.InputJsonValue }
        : {}),
      ...(editorialLayout
        ? {
            editorialLayout:
              editorialLayout as unknown as Prisma.InputJsonValue,
          }
        : {}),
      // Seed the learningLayer column with the extracted candidates. The DET-258
      // study concepts / DET-283 per-section candidates are still produced on
      // demand and merged in (see generateLearningLayer) without clobbering these.
      ...(articleConceptCandidates
        ? {
            learningLayer: {
              concepts: [],
              retrievalPrompts: [],
              articleConceptCandidates,
            } as unknown as Prisma.InputJsonValue,
          }
        : {}),
      status: report.approved
        ? TransformedArticleStatus.FINAL
        : TransformedArticleStatus.BLOCKED,
    })

    // Fire-and-forget: the article is already terminal and the poll has stopped.
    // Never awaited; self-contained (never throws).
    void this.illustrateInBackground(articleId, article, blocks)
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
   * Run the source diagnosis + routing decision; never throws. A failure logs and
   * yields null so the article still runs the v2 pipeline (the conservative path).
   */
  private tryDiagnose(
    articleId: string,
    blocks: LoadedBlock[],
    meta: SourceDiagnosisMetadata,
  ): ReturnType<SourceDiagnosisService['route']> | null {
    try {
      return this.sourceDiagnosis.route(blocks, meta)
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
      },
    })
    return rows.map((r) => ({
      id: r.id,
      type: r.blockType,
      classification: r.classification ?? TransformerBlockClass.UNCERTAIN,
      text: r.text,
      headingLevel: r.headingLevel,
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
