import {
  type Prisma,
  TransformedArticleStatus,
  TransformerSourceStatus,
  TransformerSourceType,
} from '@kibadist/prisma'
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'

import { fetchReadable } from '../inbox/url-fetch.util'
import { PrismaService } from '../prisma/prisma.service'
import {
  extractTextDocument,
  extractUrlDocument,
} from '../source-document/source-document'
import { ArticlePipelineService } from './article-pipeline.service'
import { BlockClassifierService } from './block-classifier.service'
import { extractPdfPages } from './pdf-pages.util'
import {
  type SegmentedSource,
  segmentDocument,
  segmentPdfPages,
} from './segmenter.util'

/** Extractor version stamped on a source so re-extractions are traceable. */
const EXTRACTOR_VERSION = 'transformer-extract@1'

/** Source statuses from which the pipeline is "in flight" (must not double-run). */
const SOURCE_IN_FLIGHT: ReadonlySet<TransformerSourceStatus> = new Set([
  TransformerSourceStatus.EXTRACTING,
  TransformerSourceStatus.EXTRACTED,
  TransformerSourceStatus.SEGMENTED,
  TransformerSourceStatus.CLASSIFYING,
])

/** Article statuses that mean "an article run is in flight" (spec §robustness). */
export const ARTICLE_IN_FLIGHT: ReadonlySet<TransformedArticleStatus> = new Set(
  [
    TransformedArticleStatus.QUEUED,
    TransformedArticleStatus.MODELING,
    TransformedArticleStatus.PLANNING,
    TransformedArticleStatus.GENERATING,
    TransformedArticleStatus.CHECKING,
  ],
)

/**
 * The transformer pipeline (DET-247…250): in-process async runner for
 * extract → segment → classify, with status persisted per step. There is no job
 * queue (spec §Existing assets); ingestion fires `run()` as a fire-and-forget
 * promise and the web polls status.
 *
 * Robustness (spec §Pipeline robustness, MANDATORY):
 *  - OnApplicationBootstrap sweep: any source/article left in a non-terminal
 *    status by a crash/restart is moved to FAILED/EXTRACTION_FAILED with
 *    "interrupted by restart; re-run".
 *  - In-flight guard: a source whose status is already in flight is never
 *    re-run (the ingestion path and this guard both prevent double-runs).
 *
 * ZERO AI in extraction/segmentation (DET-247/248); the single AI call is the
 * batched block classification, inside BlockClassifierService.
 */
@Injectable()
export class PipelineService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PipelineService.name)
  /** In-process guard against concurrently running the same source twice. */
  private readonly running = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: BlockClassifierService,
    // Optional so the Wave A unit tests (which exercise only extract→classify)
    // can construct the pipeline without the M2/M3 article services. In the app
    // it is always provided by DI; `onSourceReady` no-ops when it is absent.
    private readonly articlePipeline?: ArticlePipelineService,
  ) {}

  /**
   * Startup sweep: a single-instance dev deployment can crash mid-pipeline,
   * leaving rows in a non-terminal status that nothing will ever advance. Move
   * them to a terminal failed state so the UI shows a re-runnable error rather
   * than a forever-spinning row.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const sources = await this.prisma.transformerSource.updateMany({
        where: {
          status: {
            in: [
              TransformerSourceStatus.INGESTED,
              TransformerSourceStatus.EXTRACTING,
              TransformerSourceStatus.EXTRACTED,
              TransformerSourceStatus.SEGMENTED,
              TransformerSourceStatus.CLASSIFYING,
            ],
          },
        },
        data: {
          status: TransformerSourceStatus.FAILED,
          extractionError: 'interrupted by restart; re-run',
        },
      })
      const articles = await this.prisma.transformedArticle.updateMany({
        where: { status: { in: [...ARTICLE_IN_FLIGHT] } },
        data: {
          status: TransformedArticleStatus.FAILED,
          error: 'interrupted by restart; re-run',
        },
      })
      if (sources.count > 0 || articles.count > 0) {
        this.logger.warn(
          `Startup sweep: ${sources.count} source(s) and ${articles.count} article(s) marked FAILED (interrupted by restart).`,
        )
      }
    } catch (error) {
      // Never let the sweep crash boot.
      this.logger.error(
        `Startup sweep failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Run the full M1 pipeline for one source. Fire-and-forget from ingestion; the
   * caller should `.catch()` it. Never throws — failures are persisted onto the
   * source as EXTRACTION_FAILED/FAILED with a message.
   */
  async run(sourceId: string): Promise<void> {
    // In-flight guard: don't double-run a source already being processed.
    if (this.running.has(sourceId)) {
      this.logger.warn(`Pipeline already running for source ${sourceId}; skip.`)
      return
    }
    this.running.add(sourceId)
    try {
      await this.runInner(sourceId)
    } catch (error) {
      this.logger.error(
        `Pipeline crashed for source ${sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      await this.failSource(
        sourceId,
        TransformerSourceStatus.FAILED,
        error instanceof Error ? error.message : 'pipeline failed',
      )
    } finally {
      this.running.delete(sourceId)
    }
  }

  private async runInner(sourceId: string): Promise<void> {
    const source = await this.prisma.transformerSource.findUnique({
      where: { id: sourceId },
    })
    if (!source) {
      this.logger.warn(`Pipeline: source ${sourceId} not found; skip.`)
      return
    }
    // Re-entrancy guard against a DB-observed in-flight status (e.g. a stale
    // call): only run from a clean starting status.
    if (SOURCE_IN_FLIGHT.has(source.status)) {
      this.logger.warn(
        `Pipeline: source ${sourceId} already in flight (${source.status}); skip.`,
      )
      return
    }

    // --- 1. Extract (ZERO AI) -------------------------------------------------
    await this.setStatus(sourceId, TransformerSourceStatus.EXTRACTING)
    let segmented: SegmentedSource
    let degraded = false
    let pageCount: number | undefined
    let clipped = false
    try {
      const extraction = await this.extract(source)
      segmented = extraction.segmented
      degraded = extraction.degraded
      pageCount = extraction.pageCount
      clipped = extraction.clipped ?? false
    } catch (error) {
      await this.failSource(
        sourceId,
        TransformerSourceStatus.EXTRACTION_FAILED,
        error instanceof Error ? error.message : 'extraction failed',
      )
      return
    }
    await this.prisma.transformerSource.update({
      where: { id: sourceId },
      data: { status: TransformerSourceStatus.EXTRACTED },
    })

    // --- 2. Segment (ZERO AI) -------------------------------------------------
    // Bump blocksVersion; write the new block rows at that version. Old versions
    // are retained so any article pinning them stays valid (DET-249).
    const nextVersion = source.blocksVersion + 1
    const truncated =
      clipped ||
      segmented.blocks.length >= 600 ||
      segmented.extractedText.length >= 50_000
    const metadata = mergeMetadata(source.metadata, {
      truncated,
      degraded,
      ...(pageCount !== undefined ? { pageCount } : {}),
    })

    await this.prisma.$transaction([
      this.prisma.transformerSource.update({
        where: { id: sourceId },
        data: {
          status: TransformerSourceStatus.SEGMENTED,
          extractedText: segmented.extractedText,
          extractorVersion: EXTRACTOR_VERSION,
          blocksVersion: nextVersion,
          metadata,
        },
      }),
      this.prisma.transformerSourceBlock.createMany({
        data: segmented.blocks.map((b) => ({
          sourceId,
          version: nextVersion,
          orderIndex: b.orderIndex,
          blockType: b.blockType,
          text: b.text,
          pageNumber: b.pageNumber,
          charStart: b.charStart,
          charEnd: b.charEnd,
        })),
      }),
    ])

    // --- 3. Classify (ONE batched AI call, guards in code) --------------------
    await this.setStatus(sourceId, TransformerSourceStatus.CLASSIFYING)
    const rows = await this.prisma.transformerSourceBlock.findMany({
      where: { sourceId, version: nextVersion },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, orderIndex: true, blockType: true, text: true },
    })
    const resolved = await this.classifier.classify(
      rows.map((r) => ({
        index: r.orderIndex,
        blockType: r.blockType,
        text: r.text,
      })),
    )
    await this.prisma.$transaction(
      rows.map((r) => {
        const c = resolved.get(r.orderIndex)
        return this.prisma.transformerSourceBlock.update({
          where: { id: r.id },
          data: {
            classification: c?.classification ?? null,
            classificationStatus: 'classified',
            removable: c?.removable ?? false,
            noiseReason: c?.noiseReason ?? null,
          },
        })
      }),
    )

    // --- READY ----------------------------------------------------------------
    await this.setStatus(sourceId, TransformerSourceStatus.READY)
    // Wave B EXTENSION POINT: article generation hooks in here once a source is
    // READY. Currently a no-op (see onSourceReady).
    await this.onSourceReady(sourceId)
  }

  /**
   * Extract a source into segmented blocks + canonical text. ZERO AI. Per type:
   *  - TEXT: extractTextDocument over rawContent.
   *  - URL:  SSRF-validated fetchReadable, then extractUrlDocument.
   *  - PDF:  per-page extraction (unpdf mergePages:false) → page-tagged blocks.
   */
  private async extract(source: {
    id: string
    type: TransformerSourceType
    rawContent: string | null
    rawFile: Uint8Array | null
    url: string | null
  }): Promise<{
    segmented: SegmentedSource
    degraded: boolean
    pageCount?: number
    clipped?: boolean
  }> {
    switch (source.type) {
      case TransformerSourceType.TEXT: {
        const doc = extractTextDocument(source.rawContent ?? '')
        return { segmented: segmentDocument(doc), degraded: doc.degraded }
      }
      case TransformerSourceType.URL: {
        if (!source.url) throw new Error('URL source has no url')
        // Prefer the raw HTML we persisted at ingestion; re-fetch if absent.
        const html = source.rawContent ?? (await fetchReadable(source.url)).html
        const { document } = await extractUrlDocument(source.url, html)
        return {
          segmented: segmentDocument(document),
          degraded: document.degraded,
        }
      }
      case TransformerSourceType.PDF: {
        if (!source.rawFile) throw new Error('PDF source has no file bytes')
        const { pages, pageCount, clipped } = await extractPdfPages(
          Buffer.from(source.rawFile),
        )
        if (pages.length === 0) {
          throw new Error('No extractable text found in PDF')
        }
        // PDF structure is largely unrecoverable — always degraded.
        return {
          segmented: segmentPdfPages(pages),
          degraded: true,
          pageCount,
          clipped,
        }
      }
      default:
        throw new Error(`Unsupported source type: ${source.type}`)
    }
  }

  /**
   * Called once a source reaches READY: auto-create a TransformedArticle and run
   * the article-generation steps (structure model → plan → generation →
   * fidelity). `createAndRun` returns immediately after firing the article
   * pipeline as a detached promise, so READY is never blocked on generation.
   */
  protected async onSourceReady(sourceId: string): Promise<void> {
    if (!this.articlePipeline) return
    try {
      await this.articlePipeline.createAndRun(sourceId)
    } catch (error) {
      // Article creation failing must not roll back the source's READY status.
      this.logger.error(
        `Auto-create article failed for source ${sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private async setStatus(
    sourceId: string,
    status: TransformerSourceStatus,
  ): Promise<void> {
    await this.prisma.transformerSource.update({
      where: { id: sourceId },
      data: { status },
    })
  }

  private async failSource(
    sourceId: string,
    status: TransformerSourceStatus,
    message: string,
  ): Promise<void> {
    try {
      await this.prisma.transformerSource.update({
        where: { id: sourceId },
        data: { status, extractionError: message },
      })
    } catch (error) {
      this.logger.error(
        `Failed to persist failure for source ${sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

/** Shallow-merge new flags into an existing metadata JSON object. */
function mergeMetadata(
  existing: Prisma.JsonValue | null,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {}
  return { ...base, ...patch } as Prisma.InputJsonValue
}
