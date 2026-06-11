import {
  type Prisma,
  TransformedArticleStatus,
  TransformerBlockClass,
} from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'
import { AiService } from '../ai/ai.service'
import { PrismaService } from '../prisma/prisma.service'
import { ArticleEnrichmentService } from './article-enrichment.service'
import { ArticleGeneratorService } from './article-generator.service'
import { placeCallouts } from './callout-placement.util'
import { buildCoverageReport, type CoverageBlock } from './coverage.util'
import { EditorialLayoutService } from './editorial-layout.service'
import { FidelityCheckerService } from './fidelity-checker.service'
import { planAutoRender } from './illustration-budget.util'
import { IllustrationPlannerService } from './illustration-planner.service'
import { LearningLayerService } from './learning-layer.service'
import { buildQualityReport } from './quality-report.util'
import { buildReadingAids } from './reading-aids.util'
import { ReshapingPlanService } from './reshaping-plan.service'
import type {
  ArticleEnrichment,
  IllustrationPlan,
  IllustrationSuggestion,
  LearningConceptCandidate,
  LearningLayer,
  ReshapingPlan,
  SourceStructureModel,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import { StructureModelService } from './structure-model.service'
import {
  buildIllustrationImagePrompt,
  ILLUSTRATION_IMAGE_SIZE,
} from './transformer.constants'
import type {
  ArticleJsonV2,
  CoverageReport,
  EditorialLayout,
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

/** A loaded source block with everything the M2/M3 services need. */
type LoadedBlock = ClassifiedBlockInput & { uncertain: boolean }

/** Image budget per article: how many generative gpt-image-1 plates the
 *  automatic pass may spend on, bounding cost/latency (DET-319). The budget is
 *  spent on the highest-SCORING eligible plates (illustration-budget.util), not
 *  the first N. High-fidelity-risk suggestions are never auto-rendered.
 *  Programmatic diagrams are free (drawn client-side) and not capped here. */
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
    private readonly structureModel: StructureModelService,
    private readonly reshapingPlan: ReshapingPlanService,
    private readonly generator: ArticleGeneratorService,
    private readonly fidelity: FidelityCheckerService,
    private readonly illustrations: IllustrationPlannerService,
    private readonly enrichment: ArticleEnrichmentService,
    private readonly editorialLayout: EditorialLayoutService,
    private readonly learning: LearningLayerService,
    private readonly ai: AiService,
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

    // --- 6. Structure model -------------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.MODELING)
    const structureModel = await this.structureModel.build(blocks)
    await this.persist(articleId, {
      structureModel: structureModel as unknown as Prisma.InputJsonValue,
    })

    // --- 7. Reshaping plan --------------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.PLANNING)
    const plan = await this.reshapingPlan.build(structureModel, blocks)
    await this.persist(articleId, {
      reshapingPlan: plan as unknown as Prisma.InputJsonValue,
    })

    // --- 8. Article generation ----------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.GENERATING)
    const generated = await this.generator.generate(plan, blocks)
    // Inline callout placement (DET-272) is deterministic, computed in code (no
    // LLM): place the end-matter (keyTerms/examples/caveats) against the sections
    // by source-block overlap and attach it to the stored artifact. The top-level
    // arrays remain the single source of truth — these are placement REFERENCES.
    const withCallouts: ArticleJsonV2 = {
      ...generated,
      calloutPlacements: placeCallouts(generated),
    }
    // Reading aids (DET-274) are deterministic too (TOC + reading time +
    // source-grounded highlights drawn from the structure model's preserved
    // claims). They are attached HERE, before the fidelity check runs, so the
    // checker validates the highlights as traceable fragments on the enriched
    // artifact.
    const article: ArticleJsonV2 = {
      ...withCallouts,
      readingAids: buildReadingAids(withCallouts, structureModel),
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

    // The aggregated quality rollup (DET-320) — pure code over the artifacts
    // just computed. Illustrations are planned in the background after the
    // terminal status, so figureSuggestionCount legitimately reads 0 here.
    const quality = buildQualityReport({
      article,
      fidelity: report,
      coverage,
    })

    await this.persist(articleId, {
      fidelityReport: report as unknown as Prisma.InputJsonValue,
      fidelityScore: Math.round(report.fidelityScore),
      coverageReport: coverage as unknown as Prisma.InputJsonValue,
      qualityReport: quality as unknown as Prisma.InputJsonValue,
      ...(enrichment
        ? { enrichment: enrichment as unknown as Prisma.InputJsonValue }
        : {}),
      ...(editorialLayout
        ? {
            editorialLayout:
              editorialLayout as unknown as Prisma.InputJsonValue,
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
    // The reader gates the article body on `illustrationPlan` being present (it
    // means "the background pass finished, the plates are ready"). So we ALWAYS
    // persist a plan when this returns — even on failure — or a render error
    // would trap the article behind a perpetual "finishing illustrations" state.
    // On a mid-render failure we keep whatever suggestions were planned (still
    // pending, manually renderable); on a planning failure we persist an empty
    // plan so the article still shows, just without plates.
    let suggestions: IllustrationSuggestion[] = []
    try {
      const plan = await this.illustrations.plan(article, blocks)
      suggestions = plan.suggestions
      suggestions = await this.autoRenderEligible(articleId, plan.suggestions)
    } catch (error) {
      this.logger.warn(
        `Background illustrations failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    try {
      await this.persist(articleId, {
        illustrationPlan: { suggestions } as unknown as Prisma.InputJsonValue,
      })
    } catch (error) {
      this.logger.warn(
        `Persisting illustration plan failed for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Auto-render the eligible suggestions. The budget (illustration-budget.util)
   * decides WHAT: the top-scoring generative plates within MAX_AUTO_ILLUSTRATIONS,
   * plus every eligible programmatic diagram that already carries a spec (free —
   * no gpt-image-1 call). A selected plate is marked `approved` once its image
   * renders; a selected diagram is marked `approved` as-is (the spec renders
   * client-side). Everything else stays `pending` (the manual approve→render path
   * is unchanged). One render failure leaves that suggestion pending and continues.
   */
  private async autoRenderEligible(
    articleId: string,
    suggestions: IllustrationSuggestion[],
  ): Promise<IllustrationSuggestion[]> {
    const plan = planAutoRender(suggestions, {
      maxImages: MAX_AUTO_ILLUSTRATIONS,
    })
    const toRenderImage = new Set(plan.imageRenderIds)
    const toAutoDiagram = new Set(plan.diagramAutoIds)

    const out: IllustrationSuggestion[] = []
    for (const s of suggestions) {
      if (toRenderImage.has(s.id)) {
        try {
          const image = await this.renderSuggestionImage(articleId, s)
          out.push({ ...s, approval: 'approved', image })
        } catch (error) {
          this.logger.warn(
            `Auto-render failed for suggestion ${s.id} (${articleId}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
          out.push(s)
        }
      } else if (toAutoDiagram.has(s.id)) {
        // No image to generate — the diagramSpec is the figure.
        out.push({ ...s, approval: 'approved' })
      } else {
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
    const prompt = buildIllustrationImagePrompt(
      suggestion.visualDescription,
      suggestion.caption,
    )
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

  /** Generate + persist the learning layer for an article (never touches articleJson). */
  async generateLearningLayer(
    articleId: string,
    sourceId: string,
    blocksVersion: number,
  ): Promise<LearningLayer> {
    const blocks = await this.loadBlocks(sourceId, blocksVersion)
    const layer = await this.learning.build(blocks)
    await this.persist(articleId, {
      learningLayer: layer as unknown as Prisma.InputJsonValue,
    })
    return layer
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
      },
    })
    return rows.map((r) => ({
      id: r.id,
      type: r.blockType,
      classification: r.classification ?? TransformerBlockClass.UNCERTAIN,
      text: r.text,
      headingLevel: r.headingLevel,
      removable: r.removable,
      uncertain:
        r.classification === TransformerBlockClass.UNCERTAIN ||
        !r.classification,
    }))
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
