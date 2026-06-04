import {
  type Prisma,
  TransformedArticleStatus,
  TransformerBlockClass,
} from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ArticleGeneratorService } from './article-generator.service'
import { placeCallouts } from './callout-placement.util'
import { buildCoverageReport, type CoverageBlock } from './coverage.util'
import { FidelityCheckerService } from './fidelity-checker.service'
import { IllustrationPlannerService } from './illustration-planner.service'
import { LearningLayerService } from './learning-layer.service'
import { buildReadingAids } from './reading-aids.util'
import { ReshapingPlanService } from './reshaping-plan.service'
import type {
  IllustrationPlan,
  LearningLayer,
  ReshapingPlan,
  SourceStructureModel,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import { StructureModelService } from './structure-model.service'
import type {
  ArticleJsonV2,
  CoverageReport,
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

/** A loaded source block with everything the M2/M3 services need. */
type LoadedBlock = ClassifiedBlockInput & { uncertain: boolean }

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
    private readonly learning: LearningLayerService,
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
    await this.persist(articleId, {
      fidelityReport: report as unknown as Prisma.InputJsonValue,
      fidelityScore: Math.round(report.fidelityScore),
      coverageReport: coverage as unknown as Prisma.InputJsonValue,
      status: report.approved
        ? TransformedArticleStatus.FINAL
        : TransformedArticleStatus.BLOCKED,
    })
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
