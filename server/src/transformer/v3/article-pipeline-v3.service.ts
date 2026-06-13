import { type Prisma, TransformedArticleStatus } from '@kibadist/prisma'
import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service'
import { evaluateQualityGate } from './quality-gate.util'
import { planRegeneration } from './regeneration.util'
import { diagnoseSource } from './source-kind.util'
import type { ArticleJsonV3, QualityReport, V3ArticleStatus } from './v3.types'
import {
  type V3GeneratorBlock,
  V3GeneratorService,
} from './v3-generator.service'
import { resolveV3Config, shouldUseV3 } from './v3-routing.util'

/** A loaded block carrying everything diagnosis, generation, and coverage need. */
interface V3Block extends V3GeneratorBlock {
  removable: boolean
}

/**
 * v3 article pipeline (DET-343) — the strangler-pattern sibling of
 * `ArticlePipelineService`. Given a READY source it runs the source-grounded
 * learning engine:
 *
 *   diagnose source kind → generate → quality gate → (targeted regenerate once) →
 *   persist (articleJsonV3 + qualityReport + pipelineVersion='v3')
 *
 * It NEVER writes v2's columns (`articleJson`/`fidelityReport`/`coverageReport`),
 * so the v2 read boundary is untouched. The richer v3 status lives in
 * `qualityReport.status`; the row's TransformedArticleStatus is the mapped value
 * (READY_FOR_REVIEW→FINAL, BLOCKED/NEEDS_REGENERATION→BLOCKED, FAILED→FAILED) so no
 * enum migration is needed.
 *
 * Routing (`routesSource`) decides whether a source runs v3 at all — env-driven
 * feature flag + source-kind gate + per-source preview opt-in (`metadata.v3Preview`),
 * so only test/preview sources reach v3 until the fixtures pass.
 */
@Injectable()
export class ArticlePipelineV3Service {
  private readonly logger = new Logger(ArticlePipelineV3Service.name)
  private readonly running = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: V3GeneratorService,
  ) {}

  /** Resolve the v3 rollout config from the environment (re-read per call). */
  private config() {
    return resolveV3Config({
      mode: process.env.TRANSFORMER_V3_MODE,
      kinds: process.env.TRANSFORMER_V3_KINDS,
    })
  }

  /**
   * Whether THIS source should run through v3, given the env config and the
   * source's own preview opt-in. Cheap when v3 is off (no block load); otherwise
   * diagnoses the source kind so the source-kind gate can apply.
   */
  async routesSource(sourceId: string): Promise<boolean> {
    const config = this.config()
    if (config.mode === 'off') return false

    const source = await this.prisma.transformerSource.findUnique({
      where: { id: sourceId },
      select: { metadata: true, blocksVersion: true },
    })
    if (!source) return false
    const previewOptIn = readPreviewOptIn(source.metadata)

    // 'on'/'preview' may not need a diagnosis, but 'source_kind' does; diagnose
    // once and let the pure router decide.
    const blocks = await this.loadBlocks(sourceId, source.blocksVersion)
    const sourceKind = blocks.length > 0 ? diagnoseSource(blocks).kind : null
    return shouldUseV3(config, { sourceKind, previewOptIn })
  }

  /**
   * Create a v3 article row for a READY source and run the pipeline. Returns the
   * new article id; fire-and-forget the returned promise (failures persist onto
   * the article as FAILED, never thrown to the caller).
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
        pipelineVersion: 'v3',
      },
      select: { id: true },
    })

    void this.run(article.id, source.id, source.blocksVersion).catch(
      (error) => {
        this.logger.error(
          `v3 article pipeline rejected for ${article.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      },
    )
    return article.id
  }

  /** Run the v3 stages for an existing article. Never throws; persists the result. */
  async run(
    articleId: string,
    sourceId: string,
    blocksVersion: number,
  ): Promise<void> {
    if (this.running.has(articleId)) {
      this.logger.warn(`v3 article ${articleId} already running; skip.`)
      return
    }
    this.running.add(articleId)
    try {
      await this.runInner(articleId, sourceId, blocksVersion)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'v3 pipeline failed'
      this.logger.error(`v3 article ${articleId} FAILED: ${message}`)
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

    // --- Source diagnosis (deterministic) -----------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.MODELING)
    const sourceKind = diagnoseSource(blocks).kind

    // --- Source-grounded generation -----------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.GENERATING)
    let article = await this.generator.generate(blocks, sourceKind)

    // --- Quality gate -------------------------------------------------------
    await this.setStatus(articleId, TransformedArticleStatus.CHECKING)
    let report = evaluateQualityGate(article, blocks)

    // --- Repair-or-publish: one targeted regeneration pass ------------------
    if (report.status === 'BLOCKED') {
      const plan = planRegeneration(report)
      if (plan.status === 'NEEDS_REGENERATION' && plan.targets.length > 0) {
        await this.setStatus(articleId, TransformedArticleStatus.GENERATING)
        const regenerated = await this.generator.regenerate(
          blocks,
          sourceKind,
          plan.targets.map((t) => ({
            instruction: t.instruction,
            refs: t.refs,
          })),
        )
        const regenReport = evaluateQualityGate(regenerated, blocks)
        // Keep the regenerated article only if it did not get WORSE (fewer hard
        // blockers); otherwise keep the first attempt's article + report.
        if (hardCount(regenReport) <= hardCount(report)) {
          article = regenerated
          report = regenReport
        }
      }
    }

    await this.persist(articleId, {
      articleJsonV3: article as unknown as Prisma.InputJsonValue,
      qualityReport: report as unknown as Prisma.InputJsonValue,
      pipelineVersion: 'v3',
      status: mapStatus(report.status),
    })
  }

  /** Load the pinned-version blocks for a source as v3 inputs. */
  private async loadBlocks(
    sourceId: string,
    blocksVersion: number,
  ): Promise<V3Block[]> {
    const rows = await this.prisma.transformerSourceBlock.findMany({
      where: { sourceId, version: blocksVersion },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        blockType: true,
        text: true,
        classification: true,
        removable: true,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      blockType: r.blockType,
      text: r.text,
      classification: r.classification,
      removable: r.removable,
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
        `Failed to persist v3 FAILED for ${articleId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

/** Number of hard blockers in a report (the regen "did it get worse" measure). */
function hardCount(report: QualityReport): number {
  return report.blockers.filter((b) => b.severity === 'hard').length
}

/**
 * Map the richer v3 status onto the existing row enum (no enum migration). The
 * exact v3 status is preserved in `qualityReport.status`; this is only the coarse
 * row-level signal the v2 status machinery already understands.
 */
export function mapStatus(status: V3ArticleStatus): TransformedArticleStatus {
  switch (status) {
    case 'READY_FOR_REVIEW':
      return TransformedArticleStatus.FINAL
    case 'BLOCKED':
    case 'NEEDS_REGENERATION':
      return TransformedArticleStatus.BLOCKED
    case 'FAILED':
      return TransformedArticleStatus.FAILED
  }
}

/** Read the per-source v3 preview opt-in from its metadata JSON (`v3Preview`). */
function readPreviewOptIn(metadata: unknown): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as Record<string, unknown>).v3Preview === true
  )
}
