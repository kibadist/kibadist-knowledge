import {
  type Prisma,
  TransformedArticleStatus,
  TransformerSourceStatus,
  TransformerSourceType,
} from '@kibadist/prisma'
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'

import { fetchReadable } from '../inbox/url-fetch.util'
import { PrismaService } from '../prisma/prisma.service'
import { ArticlePipelineService } from './article-pipeline.service'
import type { CreateTextSourceDto } from './dto/create-text-source.dto'
import type { CreateUrlSourceDto } from './dto/create-url-source.dto'
import { ARTICLE_IN_FLIGHT, PipelineService } from './pipeline.service'
import type {
  IllustrationPlan,
  IllustrationSuggestion,
  LearningConcept,
  LearningLayer,
} from './schemas'
import type {
  CoverageReport,
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

/** A source as shown in the workspace list (status + latest article summary). */
export interface TransformerSourceListItem {
  id: string
  type: TransformerSourceType
  status: TransformerSourceStatus
  title: string | null
  url: string | null
  fileName: string | null
  createdAt: Date
  latestArticleId: string | null
  latestArticleStatus: TransformedArticleStatus | null
}

/** A single source's detail view (status, metadata, error, counts). */
export interface TransformerSourceDetail {
  id: string
  type: TransformerSourceType
  status: TransformerSourceStatus
  title: string | null
  url: string | null
  fileName: string | null
  metadata: Prisma.JsonValue | null
  extractionError: string | null
  blocksVersion: number
  blockCount: number
  createdAt: Date
  updatedAt: Date
  latestArticleId: string | null
  latestArticleStatus: TransformedArticleStatus | null
}

/** Full article detail view (article + reports + status + error). */
export interface TransformerArticleDetail {
  id: string
  sourceId: string
  status: TransformedArticleStatus
  blocksVersion: number
  article: SourcePreservingArticle | null
  fidelityReport: FidelityReport | null
  fidelityScore: number | null
  coverageReport: CoverageReport | null
  illustrationPlan: IllustrationPlan | null
  learningLayer: LearningLayer | null
  error: string | null
  createdAt: Date
  updatedAt: Date
}

/** One block in the debug-inspectable blocks view (DET-250). */
export interface TransformerBlockView {
  id: string
  orderIndex: number
  blockType: string
  text: string
  pageNumber: number | null
  charStart: number | null
  charEnd: number | null
  classification: string | null
  classificationStatus: string
  removable: boolean
  noiseReason: string | null
}

/**
 * Transformer ingestion + queries (DET-247…250). Ingestion creates a
 * TransformerSource (persisting the raw material + metadata), then fires the
 * pipeline as a fire-and-forget promise (no job queue; spec §Existing assets).
 * Zero AI on this path — extraction/segmentation are deterministic, the single
 * AI call lives in the classifier inside the pipeline.
 *
 * Every read is scoped to `{ userId, workspaceId }` (URL/PDF/text alike), so a
 * caller can never read another user's or workspace's source — identical posture
 * to the inbox endpoints.
 */
@Injectable()
export class TransformerService {
  private readonly logger = new Logger(TransformerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineService,
    private readonly articlePipeline: ArticlePipelineService,
  ) {}

  async createTextSource(
    userId: string,
    workspaceId: string,
    dto: CreateTextSourceDto,
  ): Promise<TransformerSourceListItem> {
    const title = dto.title?.trim() || deriveTitle(dto.text)
    const source = await this.prisma.transformerSource.create({
      data: {
        userId,
        workspaceId,
        type: TransformerSourceType.TEXT,
        status: TransformerSourceStatus.INGESTED,
        title,
        rawContent: dto.text,
        metadata: title ? { title } : undefined,
      },
    })
    this.fire(source.id)
    return this.toListItem(source, null)
  }

  async createUrlSource(
    userId: string,
    workspaceId: string,
    dto: CreateUrlSourceDto,
  ): Promise<TransformerSourceListItem> {
    // Fetch the page at ingestion (SSRF-validated). Persisting the raw HTML keeps
    // the pipeline's extract step deterministic and offline-replayable, and means
    // a fetch failure surfaces synchronously as a 400 rather than a failed async
    // pipeline. Extraction (chrome removal, blocks) happens later, in-pipeline.
    const page = await fetchReadable(dto.url)
    const title = page.title?.trim() || hostPathLabel(dto.url)
    const source = await this.prisma.transformerSource.create({
      data: {
        userId,
        workspaceId,
        type: TransformerSourceType.URL,
        status: TransformerSourceStatus.INGESTED,
        title,
        url: dto.url,
        rawContent: page.html,
        metadata: { title, url: dto.url },
      },
    })
    this.fire(source.id)
    return this.toListItem(source, null)
  }

  async createPdfSource(
    userId: string,
    workspaceId: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<TransformerSourceListItem> {
    const title =
      fileName
        .replace(/\.pdf$/i, '')
        .trim()
        .slice(0, 300) || 'PDF'
    const source = await this.prisma.transformerSource.create({
      data: {
        userId,
        workspaceId,
        type: TransformerSourceType.PDF,
        status: TransformerSourceStatus.INGESTED,
        title,
        fileName,
        // Prisma `Bytes` expects a Uint8Array; Buffer is a subclass but its
        // ArrayBufferLike generic doesn't structurally match — wrap to satisfy it.
        rawFile: new Uint8Array(buffer),
        metadata: { title, fileName },
      },
    })
    this.fire(source.id)
    return this.toListItem(source, null)
  }

  /** Workspace source list, newest first, each with its latest article summary. */
  async list(
    userId: string,
    workspaceId: string,
  ): Promise<TransformerSourceListItem[]> {
    const rows = await this.prisma.transformerSource.findMany({
      where: { userId, workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        articles: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    })
    return rows.map((r) => this.toListItem(r, r.articles[0] ?? null))
  }

  /** One source's detail (ownership-scoped; 404 otherwise). */
  async findOne(userId: string, id: string): Promise<TransformerSourceDetail> {
    const source = await this.prisma.transformerSource.findFirst({
      where: { id, userId },
      include: {
        articles: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
        _count: {
          select: { blocks: true },
        },
      },
    })
    if (!source) throw new NotFoundException('Source not found')
    const latest = source.articles[0] ?? null
    return {
      id: source.id,
      type: source.type,
      status: source.status,
      title: source.title,
      url: source.url,
      fileName: source.fileName,
      metadata: source.metadata,
      extractionError: source.extractionError,
      blocksVersion: source.blocksVersion,
      // Count only the current version's blocks (old versions are retained).
      blockCount: await this.currentBlockCount(source.id, source.blocksVersion),
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      latestArticleId: latest?.id ?? null,
      latestArticleStatus: latest?.status ?? null,
    }
  }

  /** Current-version blocks for a source (debug-inspectable, DET-250). */
  async blocks(userId: string, id: string): Promise<TransformerBlockView[]> {
    const source = await this.prisma.transformerSource.findFirst({
      where: { id, userId },
      select: { id: true, blocksVersion: true },
    })
    if (!source) throw new NotFoundException('Source not found')
    const rows = await this.prisma.transformerSourceBlock.findMany({
      where: { sourceId: source.id, version: source.blocksVersion },
      orderBy: { orderIndex: 'asc' },
    })
    return rows.map((b) => ({
      id: b.id,
      orderIndex: b.orderIndex,
      blockType: b.blockType,
      text: b.text,
      pageNumber: b.pageNumber,
      charStart: b.charStart,
      charEnd: b.charEnd,
      classification: b.classification,
      classificationStatus: b.classificationStatus,
      removable: b.removable,
      noiseReason: b.noiseReason,
    }))
  }

  /**
   * Re-run the transform for a source (DET-251…255). Returns the new article id.
   * 409 if an article for this source is already in flight (spec §robustness,
   * ARTICLE_IN_FLIGHT). Requires the source to be READY (have classified blocks).
   */
  async transform(userId: string, sourceId: string): Promise<{ id: string }> {
    const source = await this.prisma.transformerSource.findFirst({
      where: { id: sourceId, userId },
      select: { id: true, status: true },
    })
    if (!source) throw new NotFoundException('Source not found')
    if (source.status !== TransformerSourceStatus.READY) {
      throw new ConflictException('Source is not ready to transform')
    }
    const inFlight = await this.prisma.transformedArticle.findFirst({
      where: { sourceId, status: { in: [...ARTICLE_IN_FLIGHT] } },
      select: { id: true },
    })
    if (inFlight) {
      throw new ConflictException(
        'An article for this source is already running',
      )
    }
    const id = await this.articlePipeline.createAndRun(sourceId)
    return { id }
  }

  /** Article detail (ownership-scoped via the source's userId; 404 otherwise). */
  async getArticle(
    userId: string,
    articleId: string,
  ): Promise<TransformerArticleDetail> {
    const article = await this.findOwnedArticle(userId, articleId)
    return {
      id: article.id,
      sourceId: article.sourceId,
      status: article.status,
      blocksVersion: article.blocksVersion,
      article: article.articleJson as SourcePreservingArticle | null,
      fidelityReport: article.fidelityReport as FidelityReport | null,
      fidelityScore: article.fidelityScore,
      coverageReport: article.coverageReport as CoverageReport | null,
      illustrationPlan: article.illustrationPlan as IllustrationPlan | null,
      learningLayer: article.learningLayer as LearningLayer | null,
      error: article.error,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    }
  }

  /** Generate illustration suggestions for an article (DET-259, on demand). */
  async generateIllustrations(
    userId: string,
    articleId: string,
  ): Promise<IllustrationPlan> {
    const article = await this.findOwnedArticle(userId, articleId)
    if (!article.articleJson) {
      throw new ConflictException('Article has not been generated yet')
    }
    return this.articlePipeline.generateIllustrations(
      article.id,
      article.articleJson as unknown as SourcePreservingArticle,
      article.sourceId,
      article.blocksVersion,
    )
  }

  /** Update one illustration suggestion's approval (DET-259). */
  async updateIllustrationApproval(
    userId: string,
    articleId: string,
    suggestionId: string,
    approval: IllustrationSuggestion['approval'],
  ): Promise<IllustrationPlan> {
    const article = await this.findOwnedArticle(userId, articleId)
    const plan = article.illustrationPlan as IllustrationPlan | null
    if (!plan) throw new NotFoundException('No illustration plan')
    const suggestion = plan.suggestions.find((s) => s.id === suggestionId)
    if (!suggestion) throw new NotFoundException('Suggestion not found')
    const updated: IllustrationPlan = {
      suggestions: plan.suggestions.map((s) =>
        s.id === suggestionId ? { ...s, approval } : s,
      ),
    }
    await this.prisma.transformedArticle.update({
      where: { id: article.id },
      data: { illustrationPlan: updated as unknown as Prisma.InputJsonValue },
    })
    return updated
  }

  /** Generate the learning layer for an article (DET-258, on demand). */
  async generateLearningLayer(
    userId: string,
    articleId: string,
  ): Promise<LearningLayer> {
    const article = await this.findOwnedArticle(userId, articleId)
    return this.articlePipeline.generateLearningLayer(
      article.id,
      article.sourceId,
      article.blocksVersion,
    )
  }

  /** Update one learning-layer concept's validation status (DET-258). */
  async updateLearningItem(
    userId: string,
    articleId: string,
    itemId: string,
    validationStatus: LearningConcept['validationStatus'],
  ): Promise<LearningLayer> {
    const article = await this.findOwnedArticle(userId, articleId)
    const layer = article.learningLayer as LearningLayer | null
    if (!layer) throw new NotFoundException('No learning layer')
    const concept = layer.concepts.find((c) => c.id === itemId)
    if (!concept) throw new NotFoundException('Learning item not found')
    const updated: LearningLayer = {
      ...layer,
      concepts: layer.concepts.map((c) =>
        c.id === itemId ? { ...c, validationStatus } : c,
      ),
    }
    await this.prisma.transformedArticle.update({
      where: { id: article.id },
      data: { learningLayer: updated as unknown as Prisma.InputJsonValue },
    })
    return updated
  }

  /** Load an article, asserting it belongs to the user (via the source). 404 otherwise. */
  private async findOwnedArticle(userId: string, articleId: string) {
    const article = await this.prisma.transformedArticle.findFirst({
      where: { id: articleId, source: { userId } },
    })
    if (!article) throw new NotFoundException('Article not found')
    return article
  }

  private currentBlockCount(
    sourceId: string,
    version: number,
  ): Promise<number> {
    // blocksVersion starts at 0 before the first segmentation: no blocks yet.
    if (version === 0) return Promise.resolve(0)
    return this.prisma.transformerSourceBlock.count({
      where: { sourceId, version },
    })
  }

  /** Fire the pipeline as a detached promise; failures are persisted in-pipeline. */
  private fire(sourceId: string): void {
    void this.pipeline.run(sourceId).catch((error) => {
      this.logger.error(
        `Pipeline promise rejected for ${sourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    })
  }

  private toListItem(
    source: {
      id: string
      type: TransformerSourceType
      status: TransformerSourceStatus
      title: string | null
      url: string | null
      fileName: string | null
      createdAt: Date
    },
    latest: { id: string; status: TransformedArticleStatus } | null,
  ): TransformerSourceListItem {
    return {
      id: source.id,
      type: source.type,
      status: source.status,
      title: source.title,
      url: source.url,
      fileName: source.fileName,
      createdAt: source.createdAt,
      latestArticleId: latest?.id ?? null,
      latestArticleStatus: latest?.status ?? null,
    }
  }
}

function deriveTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return 'Untitled source'
  return firstLine.slice(0, 300)
}

function hostPathLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 300)
  } catch {
    return rawUrl.slice(0, 300)
  }
}
