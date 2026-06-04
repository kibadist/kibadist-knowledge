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

import { AiService } from '../ai/ai.service'
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
import { ILLUSTRATION_IMAGE_SIZE } from './transformer.constants'
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
  articleJson: SourcePreservingArticle | null
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
    private readonly ai: AiService,
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
    return this.blocksForVersion(source.id, source.blocksVersion)
  }

  /**
   * Blocks at the article's PINNED blocksVersion (DET-249/257). The source
   * inspector must resolve an article's sourceBlockIds against the version the
   * article was generated from — a later re-extraction bumps the source's
   * current version and would orphan every reference.
   */
  async articleBlocks(
    userId: string,
    articleId: string,
  ): Promise<TransformerBlockView[]> {
    const article = await this.findOwnedArticle(userId, articleId)
    return this.blocksForVersion(article.sourceId, article.blocksVersion)
  }

  private async blocksForVersion(
    sourceId: string,
    version: number,
  ): Promise<TransformerBlockView[]> {
    const rows = await this.prisma.transformerSourceBlock.findMany({
      where: { sourceId, version },
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
      articleJson: article.articleJson as SourcePreservingArticle | null,
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

  /**
   * Mutate an article's illustrationPlan JSON atomically. The plan is a single
   * JSON blob, so every mutator does read-modify-write of the whole
   * `suggestions[]` array — two concurrent mutations (e.g. rendering two
   * suggestions, or a render racing an approval) would each write back only
   * their own patch and silently drop the other's (lost update). Locking the
   * article row with `FOR UPDATE` and re-reading the plan inside the transaction
   * serialises them, so each patch derives from the latest committed plan.
   * `apply` runs inside the tx (it may also write the image bytes table) and
   * returns the next plan derived from the freshly-read one.
   */
  private async withLockedPlan(
    articleId: string,
    apply: (
      plan: IllustrationPlan,
      tx: Prisma.TransactionClient,
    ) => Promise<IllustrationPlan>,
  ): Promise<IllustrationPlan> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "transformed_articles" WHERE id = ${articleId} FOR UPDATE`
      const row = await tx.transformedArticle.findUnique({
        where: { id: articleId },
        select: { illustrationPlan: true },
      })
      const plan: IllustrationPlan =
        (row?.illustrationPlan as IllustrationPlan | null) ?? {
          suggestions: [],
        }
      const updated = await apply(plan, tx)
      await tx.transformedArticle.update({
        where: { id: articleId },
        data: { illustrationPlan: updated as unknown as Prisma.InputJsonValue },
      })
      return updated
    })
  }

  /** Update one illustration suggestion's approval (DET-259). */
  async updateIllustrationApproval(
    userId: string,
    articleId: string,
    suggestionId: string,
    approval: IllustrationSuggestion['approval'],
  ): Promise<IllustrationPlan> {
    const article = await this.findOwnedArticle(userId, articleId)
    if (!article.illustrationPlan)
      throw new NotFoundException('No illustration plan')
    return this.withLockedPlan(article.id, async (plan) => {
      if (!plan.suggestions.some((s) => s.id === suggestionId))
        throw new NotFoundException('Suggestion not found')
      return {
        suggestions: plan.suggestions.map((s) =>
          s.id === suggestionId ? { ...s, approval } : s,
        ),
      }
    })
  }

  /**
   * Render an approved illustration suggestion into a real image (DET-261).
   *
   * Every guard is enforced in CODE, never trusted from the client, in order:
   *   1. ownership (findOwnedArticle)
   *   2. the suggestion exists in the illustrationPlan → else 404
   *   3. suggestion.approval === 'approved' → else 409
   *   4. high fidelityRisk requires confirmHighRisk → else 409
   * The prompt is built ONLY from the approved suggestion text (visualDescription
   * + caption); the renderer never consults the source blocks. The bytes are
   * upserted into TransformerIllustrationImage on (articleId, suggestionId) and
   * the suggestion's `image` metadata is patched into the illustrationPlan JSON
   * (never into the article body). Returns the updated IllustrationPlan.
   */
  async renderIllustration(
    userId: string,
    articleId: string,
    suggestionId: string,
    confirmHighRisk: boolean,
  ): Promise<IllustrationPlan> {
    const article = await this.findOwnedArticle(userId, articleId)
    const plan = article.illustrationPlan as IllustrationPlan | null
    if (!plan) throw new NotFoundException('No illustration plan')
    const suggestion = plan.suggestions.find((s) => s.id === suggestionId)
    if (!suggestion) throw new NotFoundException('Suggestion not found')
    if (suggestion.approval !== 'approved') {
      throw new ConflictException('Only approved suggestions can be rendered')
    }
    if (suggestion.fidelityRisk === 'high' && !confirmHighRisk) {
      throw new ConflictException(
        'High-risk suggestions require explicit confirmation',
      )
    }

    // Prompt uses ONLY the approved suggestion text — never the source blocks.
    const prompt = `${suggestion.visualDescription}\n\nCaption: ${suggestion.caption}`
    const result = await this.ai.image({
      prompt,
      size: ILLUSTRATION_IMAGE_SIZE,
    })
    const generatedAt = new Date().toISOString()

    const bytes = new Uint8Array(Buffer.from(result.base64, 'base64'))
    const imageRow = {
      // Prisma `Bytes` expects a Uint8Array (see createPdfSource note).
      data: bytes,
      mediaType: result.mediaType,
      width: result.width,
      height: result.height,
      provider: this.ai.providerName,
      model: result.model,
      prompt,
    }
    const imageMeta = {
      width: result.width,
      height: result.height,
      provider: this.ai.providerName,
      model: result.model,
      generatedAt,
    }
    // Atomic + race-safe: lock the article row, re-read the plan, and patch only
    // this suggestion's `image` from the latest committed plan — so a concurrent
    // render/approval of another suggestion is never clobbered, and the image
    // bytes + the plan's `image` metadata can never desync.
    return this.withLockedPlan(article.id, async (fresh, tx) => {
      await tx.transformerIllustrationImage.upsert({
        where: {
          articleId_suggestionId: { articleId: article.id, suggestionId },
        },
        create: { articleId: article.id, suggestionId, ...imageRow },
        update: imageRow,
      })
      return {
        suggestions: fresh.suggestions.map((s) =>
          s.id === suggestionId ? { ...s, image: imageMeta } : s,
        ),
      }
    })
  }

  /**
   * The stored bytes for a rendered illustration (DET-261), ownership-scoped.
   * 404 if the suggestion was never rendered. The controller streams these with
   * the stored Content-Type.
   */
  async getIllustrationImage(
    userId: string,
    articleId: string,
    suggestionId: string,
  ): Promise<{ data: Buffer; mediaType: string }> {
    const article = await this.findOwnedArticle(userId, articleId)
    const image = await this.prisma.transformerIllustrationImage.findUnique({
      where: {
        articleId_suggestionId: { articleId: article.id, suggestionId },
      },
      select: { data: true, mediaType: true },
    })
    if (!image) throw new NotFoundException('No image for this suggestion')
    return { data: Buffer.from(image.data), mediaType: image.mediaType }
  }

  /**
   * Remove a rendered illustration (DET-261): delete the row and clear the
   * suggestion's `image` metadata from the illustrationPlan. Ownership-scoped.
   * Returns the updated IllustrationPlan.
   */
  async deleteIllustrationImage(
    userId: string,
    articleId: string,
    suggestionId: string,
  ): Promise<IllustrationPlan> {
    const article = await this.findOwnedArticle(userId, articleId)
    const plan = article.illustrationPlan as IllustrationPlan | null
    if (!plan) throw new NotFoundException('No illustration plan')
    if (!plan.suggestions.some((s) => s.id === suggestionId))
      throw new NotFoundException('Suggestion not found')

    // Atomic + race-safe: drop the bytes and clear the plan's `image` field
    // together, under the article-row lock + re-read (see withLockedPlan).
    return this.withLockedPlan(article.id, async (fresh, tx) => {
      await tx.transformerIllustrationImage.deleteMany({
        where: { articleId: article.id, suggestionId },
      })
      return {
        suggestions: fresh.suggestions.map((s) =>
          s.id === suggestionId ? { ...s, image: null } : s,
        ),
      }
    })
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
