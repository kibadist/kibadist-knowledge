import {
  type CaptureSource,
  type Prisma,
  TransformedArticleStatus,
  TransformerSourceStatus,
  TransformerSourceType,
} from '@kibadist/prisma'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ConceptStateService } from '../concept-state/concept-state.service'
import { fetchReadable } from '../inbox/url-fetch.util'
import { PrismaService } from '../prisma/prisma.service'
import { isArticleV2, toArticleV2 } from './article-compat.util'
import { ArticlePipelineService } from './article-pipeline.service'
import { isArticleV3 } from './article-v3.schema'
import type { ArticleJsonV3 } from './article-v3.types'
import { placeCallouts } from './callout-placement.util'
import type { CreateTextSourceDto } from './dto/create-text-source.dto'
import type { CreateUrlSourceDto } from './dto/create-url-source.dto'
import { ARTICLE_IN_FLIGHT, PipelineService } from './pipeline.service'
import { buildReadingAids } from './reading-aids.util'
import type {
  ArticleEnrichment,
  IllustrationPlan,
  IllustrationSuggestion,
  LearningConcept,
  LearningConceptCandidate,
  LearningLayer,
  RetrievalPrompt,
  SourceStructureModel,
} from './schemas'
import { ILLUSTRATION_IMAGE_SIZE } from './transformer.constants'
import type {
  ArticleJsonV2,
  ArticleQualityReportV3,
  CoverageReport,
  EditorialLayout,
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Ensure a v2 article carries inline callout placements (DET-272). Pipeline-
 * produced articles already have them; legacy v1 (post-adaptation) and pre-wave
 * v2 articles do not — placement is deterministic and cheap, so we compute it at
 * the read boundary rather than rewriting stored JSON. Existing placements are
 * preserved (idempotent).
 */
function withCalloutPlacements(article: ArticleJsonV2): ArticleJsonV2 {
  if (article.calloutPlacements) return article
  return { ...article, calloutPlacements: placeCallouts(article) }
}

/**
 * Ensure a v2 article carries reading aids (DET-274). Pipeline-produced articles
 * already have them; legacy v1 (post-adaptation) and pre-wave v2 articles do not
 * — TOC + reading time + source-grounded highlights are deterministic, so we
 * compute them at the read boundary rather than rewriting stored JSON. The stored
 * structure model (when present) lets claims-based highlights work for old
 * articles too. Existing reading aids are preserved (idempotent).
 */
function withReadingAids(
  article: ArticleJsonV2,
  structureModel: SourceStructureModel | null,
): ArticleJsonV2 {
  if (article.readingAids) return article
  const readingAids = buildReadingAids(article, structureModel)
  if (!readingAids) return article
  return { ...article, readingAids }
}

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
  /**
   * v2 OR v3 to the client. The server is the single adaptation boundary
   * (DET-277): legacy v1 is adapted to v2 read-time, native v2 passes through.
   * Article JSON v3 (DET-344) is a parallel contract with its own learning-first
   * reader (DET-357) + review surface (DET-359), so it passes through verbatim —
   * the client dispatches on `schemaVersion`. v3 is never run through the v2
   * adapter (which would mis-parse it as v1).
   */
  articleJson: ArticleJsonV2 | ArticleJsonV3 | null
  fidelityReport: FidelityReport | null
  fidelityScore: number | null
  coverageReport: CoverageReport | null
  /** Fidelity-review rollup (DET-354); null on rows generated before the review. */
  qualityReport: ArticleQualityReportV3 | null
  illustrationPlan: IllustrationPlan | null
  learningLayer: LearningLayer | null
  /** AI-added encyclopedia metadata (DET-319) — NOT source-grounded; UI labels it. */
  enrichment: ArticleEnrichment | null
  /** Generative editorial layout — additive presentation lane; null on old rows. */
  editorialLayout: EditorialLayout | null
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
    private readonly conceptState: ConceptStateService,
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
    return this.persistUrlSource(
      userId,
      workspaceId,
      dto.url,
      page.html,
      page.title,
    )
  }

  /**
   * Create a URL source from an ALREADY-FETCHED page (DET-300). The unified inbox
   * capture (InboxService) fetches the page once — for the inbox concept's
   * structured document — and hands the raw HTML here so the same URL isn't
   * fetched twice. Otherwise identical to createUrlSource: persist the raw HTML +
   * fire the pipeline.
   */
  async createUrlSourceFromHtml(
    userId: string,
    workspaceId: string,
    url: string,
    html: string,
    pageTitle?: string | null,
  ): Promise<TransformerSourceListItem> {
    return this.persistUrlSource(userId, workspaceId, url, html, pageTitle)
  }

  private async persistUrlSource(
    userId: string,
    workspaceId: string,
    url: string,
    html: string,
    pageTitle?: string | null,
  ): Promise<TransformerSourceListItem> {
    const title = pageTitle?.trim() || hostPathLabel(url)
    const source = await this.prisma.transformerSource.create({
      data: {
        userId,
        workspaceId,
        type: TransformerSourceType.URL,
        status: TransformerSourceStatus.INGESTED,
        title,
        url,
        rawContent: html,
        metadata: { title, url },
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
    // Adapt v1 → v2 at the read boundary so the web only ever sees v2; stored
    // JSON is never rewritten and adaptation is idempotent for native v2.
    const stored = article.articleJson as
      | SourcePreservingArticle
      | ArticleJsonV2
      | null
    // Article JSON v3 (DET-344) is a PARALLEL contract with its own learning-first
    // reader (DET-357) and concept/retrieval review surface (DET-359). It must
    // NEVER be run through the v2 adapter below (which would mis-parse it as a
    // legacy v1 doc), so we return it verbatim and let the client dispatch on
    // `schemaVersion`. The reader can only render v3 once it can load it, so this
    // pass-through is what makes the v3 reader (and its review panels) reachable
    // end-to-end — without it the only article-read path 409s every v3 record.
    if (isArticleV3(stored)) {
      return {
        id: article.id,
        sourceId: article.sourceId,
        status: article.status,
        blocksVersion: article.blocksVersion,
        articleJson: stored,
        fidelityReport: article.fidelityReport as FidelityReport | null,
        fidelityScore: article.fidelityScore,
        coverageReport: article.coverageReport as CoverageReport | null,
        qualityReport: article.qualityReport as ArticleQualityReportV3 | null,
        illustrationPlan: article.illustrationPlan as IllustrationPlan | null,
        learningLayer: article.learningLayer as LearningLayer | null,
        enrichment: article.enrichment as ArticleEnrichment | null,
        editorialLayout: article.editorialLayout as EditorialLayout | null,
        error: article.error,
        createdAt: article.createdAt,
        updatedAt: article.updatedAt,
      }
    }
    // Inline callout placement (DET-272) is deterministic and cheap, so compute
    // it here for any article that lacks it — legacy v1 articles and v2 articles
    // generated before this wave. The adapter stays representation-only on
    // purpose (toArticleV2 must not invent placement); placement is layered on at
    // the read boundary, after adaptation. Native v2 articles produced by the
    // pipeline already carry `calloutPlacements`, so this is a no-op for them.
    //
    // Reading aids (DET-274) are layered on the same way: pre-wave articles lack
    // them, so we compute TOC + reading time + source-grounded highlights here.
    // The stored structureModel lets claims-based highlights work for old
    // articles too; native v2 articles already carry readingAids (no-op).
    const structureModel =
      (article.structureModel as SourceStructureModel | null) ?? null
    const adapted = stored
      ? withReadingAids(
          withCalloutPlacements(toArticleV2(stored)),
          structureModel,
        )
      : null
    return {
      id: article.id,
      sourceId: article.sourceId,
      status: article.status,
      blocksVersion: article.blocksVersion,
      articleJson: adapted,
      fidelityReport: article.fidelityReport as FidelityReport | null,
      fidelityScore: article.fidelityScore,
      coverageReport: article.coverageReport as CoverageReport | null,
      qualityReport: article.qualityReport as ArticleQualityReportV3 | null,
      illustrationPlan: article.illustrationPlan as IllustrationPlan | null,
      learningLayer: article.learningLayer as LearningLayer | null,
      enrichment: article.enrichment as ArticleEnrichment | null,
      editorialLayout: article.editorialLayout as EditorialLayout | null,
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
    // Pass the article's extracted key claims (DET-352) as retrieval-prompt seeds.
    const stored = article.articleJson as
      | SourcePreservingArticle
      | ArticleJsonV2
      | null
    const keyClaims =
      stored && isArticleV2(stored) ? (stored.keyClaims ?? []) : []
    return this.articlePipeline.generateLearningLayer(
      article.id,
      article.sourceId,
      article.blocksVersion,
      keyClaims,
    )
  }

  /**
   * Mutate an article's learningLayer JSON atomically (DET-283). The learning
   * layer is a single JSON blob, so concurrent mutations (re-extracting a
   * section's candidates while validating another, say) would each write back
   * only their own patch and silently drop the other's (lost update) — the same
   * class `withLockedPlan` solves for illustrations. Locking the article row with
   * `FOR UPDATE` and re-reading the layer inside the transaction serialises them,
   * so each patch derives from the latest committed layer. `apply` returns the
   * next layer derived from the freshly-read one.
   */
  private async withLockedLearningLayer(
    articleId: string,
    apply: (
      layer: LearningLayer,
      tx: Prisma.TransactionClient,
    ) => Promise<LearningLayer> | LearningLayer,
  ): Promise<LearningLayer> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "transformed_articles" WHERE id = ${articleId} FOR UPDATE`
      const row = await tx.transformedArticle.findUnique({
        where: { id: articleId },
        select: { learningLayer: true },
      })
      const layer: LearningLayer =
        (row?.learningLayer as LearningLayer | null) ?? {
          concepts: [],
          retrievalPrompts: [],
        }
      const updated = await apply(layer, tx)
      await tx.transformedArticle.update({
        where: { id: articleId },
        data: { learningLayer: updated as unknown as Prisma.InputJsonValue },
      })
      return updated
    })
  }

  /**
   * Extract per-section concept CANDIDATES and append them to the article's
   * learningLayer JSON (DET-283). Candidates are PROPOSALS — aiAssisted,
   * unvalidated, source-grounded — and NEVER create a library Concept row; user
   * validation stays explicit (see updateLearningItem).
   *
   * Re-extraction rule: re-running for the same section REPLACES that section's
   * PENDING candidates, while KEEPING any the user already validated or dismissed
   * (their decisions are not discarded by a fresh extraction). The append is done
   * under the per-article row lock + re-read so a concurrent validate/extract can
   * never clobber it.
   */
  async extractSectionConcepts(
    userId: string,
    articleId: string,
    sectionId: string,
  ): Promise<LearningLayer> {
    const article = await this.findOwnedArticle(userId, articleId)
    if (!article.articleJson) {
      throw new ConflictException('Article has not been generated yet')
    }
    // The extractor needs v2; stored JSON may be legacy v1 — adapt at this read
    // boundary exactly as getArticle does (representation-only).
    const v2 = toArticleV2(
      article.articleJson as unknown as SourcePreservingArticle | ArticleJsonV2,
    )
    const candidates = await this.articlePipeline.extractSectionConcepts(
      v2,
      sectionId,
      article.sourceId,
      article.blocksVersion,
    )
    return this.withLockedLearningLayer(article.id, (layer) => {
      const existing = layer.conceptCandidates ?? []
      // Keep this section's already-decided candidates; drop only its pending
      // ones (they are superseded by the fresh extraction). Other sections are
      // untouched.
      const kept = existing.filter(
        (c) => c.sectionId !== sectionId || c.validationStatus !== 'pending',
      )
      return { ...layer, conceptCandidates: [...kept, ...candidates] }
    })
  }

  /**
   * Update one learning-layer item's validation status (DET-258/283). The item id
   * is looked up across `concepts` AND `conceptCandidates` (retrievalPrompts have
   * no validation state).
   *
   * Validating a CANDIDATE is the explicit user action that turns an article
   * extraction into a "to learn" concept: it creates a real Concept row (status
   * INBOX, cognitive state SEEN — the same shape as a capture) carrying verbatim
   * source-block provenance + `originArticleId`, then stamps the created id back
   * onto the candidate as `conceptId`. The presence of `conceptId` makes this
   * idempotent — re-validating never creates a second row. Dismissal never
   * creates anything, and DET-258 study concepts only flip status (they are
   * comprehension scaffolds, not extraction-to-learning flow). All of it runs
   * atomically under the per-article row lock.
   */
  async updateLearningItem(
    userId: string,
    articleId: string,
    itemId: string,
    validationStatus: LearningConcept['validationStatus'],
  ): Promise<LearningLayer> {
    const article = await this.findOwnedArticle(userId, articleId)
    const current = article.learningLayer as LearningLayer | null
    if (!current) throw new NotFoundException('No learning layer')
    const inConcepts = current.concepts.some((c) => c.id === itemId)
    const inCandidates = (current.conceptCandidates ?? []).some(
      (c) => c.id === itemId,
    )
    if (!inConcepts && !inCandidates) {
      throw new NotFoundException('Learning item not found')
    }
    return this.withLockedLearningLayer(article.id, async (layer, tx) => {
      const candidate = layer.conceptCandidates?.find((c) => c.id === itemId)
      let conceptId = candidate?.conceptId
      if (candidate && validationStatus === 'validated' && !conceptId) {
        conceptId = await this.createConceptFromCandidate(
          tx,
          userId,
          article.workspaceId,
          article.sourceId,
          article.blocksVersion,
          article.id,
          candidate,
        )
      }
      return {
        ...layer,
        concepts: layer.concepts.map((c) =>
          c.id === itemId ? { ...c, validationStatus } : c,
        ),
        conceptCandidates: layer.conceptCandidates?.map((c) =>
          c.id === itemId
            ? { ...c, validationStatus, ...(conceptId ? { conceptId } : {}) }
            : c,
        ),
      }
    })
  }

  /**
   * Edit a learning item's CONTENT in place (DET-359): the v3 review panel lets
   * the reader fix a concept's label/definition (or importance) before deciding
   * on it. This is content-only — it NEVER changes validationStatus and NEVER
   * creates a Concept row, so editing can't be a back door to internalizing
   * knowledge. The item id is looked up across `concepts` and `conceptCandidates`
   * (retrieval prompts have their own endpoint). At least one field must be set.
   */
  async editLearningItem(
    userId: string,
    articleId: string,
    itemId: string,
    edit: {
      label?: string
      definition?: string
      importance?: 'high' | 'medium' | 'low'
    },
  ): Promise<LearningLayer> {
    if (
      edit.label === undefined &&
      edit.definition === undefined &&
      edit.importance === undefined
    ) {
      throw new BadRequestException('Nothing to edit')
    }
    const article = await this.findOwnedArticle(userId, articleId)
    const current = article.learningLayer as LearningLayer | null
    if (!current) throw new NotFoundException('No learning layer')
    const inConcepts = current.concepts.some((c) => c.id === itemId)
    const inCandidates = (current.conceptCandidates ?? []).some(
      (c) => c.id === itemId,
    )
    if (!inConcepts && !inCandidates) {
      throw new NotFoundException('Learning item not found')
    }
    // Only the fields actually provided are overwritten; `importance` applies to
    // candidates only (concepts have no importance field in the schema).
    const applyConcept = (c: LearningConcept): LearningConcept => ({
      ...c,
      ...(edit.label !== undefined ? { label: edit.label } : {}),
      ...(edit.definition !== undefined ? { definition: edit.definition } : {}),
    })
    const applyCandidate = (
      c: LearningConceptCandidate,
    ): LearningConceptCandidate => ({
      ...c,
      ...(edit.label !== undefined ? { label: edit.label } : {}),
      ...(edit.definition !== undefined ? { definition: edit.definition } : {}),
      ...(edit.importance !== undefined ? { importance: edit.importance } : {}),
    })
    return this.withLockedLearningLayer(article.id, (layer) => ({
      ...layer,
      concepts: layer.concepts.map((c) =>
        c.id === itemId ? applyConcept(c) : c,
      ),
      conceptCandidates: layer.conceptCandidates?.map((c) =>
        c.id === itemId ? applyCandidate(c) : c,
      ),
    }))
  }

  /**
   * Update a retrieval prompt's review state (DET-359). Persists the
   * suggested/saved/answered/rejected status, the reader's own-words answer, and
   * in-place prompt edits. It deliberately CANNOT schedule a permanent review
   * card — there is no "scheduled" status here — so a prompt never becomes a
   * review card without the explicit, separately-gated downstream action. An
   * `answered` status requires a non-empty `userAnswer` (the scheduling gate is
   * a user-authored answer, not a bare status flip). Runs under the per-article
   * row lock like the other learning-layer mutations.
   */
  async updateRetrievalPromptReview(
    userId: string,
    articleId: string,
    promptId: string,
    patch: {
      reviewStatus?: 'suggested' | 'saved' | 'answered' | 'rejected'
      userAnswer?: string
      prompt?: string
    },
  ): Promise<LearningLayer> {
    if (
      patch.reviewStatus === undefined &&
      patch.userAnswer === undefined &&
      patch.prompt === undefined
    ) {
      throw new BadRequestException('Nothing to update')
    }
    if (patch.prompt !== undefined && patch.prompt.trim().length === 0) {
      throw new BadRequestException('Prompt text cannot be empty')
    }
    const article = await this.findOwnedArticle(userId, articleId)
    const current = article.learningLayer as LearningLayer | null
    if (!current) throw new NotFoundException('No learning layer')
    const target = current.retrievalPrompts.find((p) => p.id === promptId)
    if (!target) throw new NotFoundException('Retrieval prompt not found')
    // The answer is the scheduling gate: marking a prompt 'answered' is only
    // meaningful with a non-empty answer (either supplied now or already stored).
    const nextAnswer = patch.userAnswer ?? target.userAnswer
    if (
      patch.reviewStatus === 'answered' &&
      (nextAnswer === undefined || nextAnswer.trim().length === 0)
    ) {
      throw new BadRequestException('An answer is required to mark answered')
    }
    return this.withLockedLearningLayer(article.id, (layer) => ({
      ...layer,
      retrievalPrompts: layer.retrievalPrompts.map(
        (p): RetrievalPrompt =>
          p.id === promptId
            ? {
                ...p,
                ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
                ...(patch.reviewStatus !== undefined
                  ? { reviewStatus: patch.reviewStatus }
                  : {}),
                ...(patch.userAnswer !== undefined
                  ? { userAnswer: patch.userAnswer }
                  : {}),
              }
            : p,
      ),
    }))
  }

  /**
   * Record the v3 reader's review decision for one CONCEPT CANDIDATE (DET-359),
   * keyed by the Article JSON v3 `keyConcepts[].id`. This is an id-agnostic
   * OVERLAY write: the article body owns the suggestion, this stores only the
   * reader's decision (accept / reject / defer / in-place edit). Crucially,
   * `accepted` is a user-review status ONLY — it has NO concept-row side effect,
   * so accepting can never internalize a concept into permanent knowledge (the
   * DET-359 invariant). Runs under the per-article row lock like the other
   * learning-layer mutations. An all-empty patch is rejected.
   */
  async setV3ConceptReview(
    userId: string,
    articleId: string,
    conceptId: string,
    patch: {
      status?: 'pending' | 'accepted' | 'rejected' | 'deferred'
      label?: string
      definition?: string
      importance?: 'high' | 'medium' | 'low'
    },
  ): Promise<LearningLayer> {
    if (
      patch.status === undefined &&
      patch.label === undefined &&
      patch.definition === undefined &&
      patch.importance === undefined
    ) {
      throw new BadRequestException('Nothing to update')
    }
    await this.findOwnedArticle(userId, articleId)
    return this.withLockedLearningLayer(articleId, (layer) => {
      const concepts = { ...(layer.v3Review?.concepts ?? {}) }
      const prev = concepts[conceptId] ?? { status: 'pending' as const }
      concepts[conceptId] = {
        ...prev,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.definition !== undefined
          ? { definition: patch.definition }
          : {}),
        ...(patch.importance !== undefined
          ? { importance: patch.importance }
          : {}),
      }
      return { ...layer, v3Review: { ...(layer.v3Review ?? {}), concepts } }
    })
  }

  /**
   * Record the v3 reader's review decision for one RETRIEVAL PROMPT (DET-359),
   * keyed by the Article JSON v3 `retrievalPrompts[].id`. Like the concept
   * overlay this is an id-agnostic write. It can NEVER schedule a permanent
   * review card (no "scheduled" status exists), so a prompt never becomes a
   * review card without the explicit, separately-gated downstream action. An
   * `answered` status requires a non-empty answer (supplied now or already
   * stored) — the scheduling gate is a user-authored answer, not a bare flip.
   */
  async setV3PromptReview(
    userId: string,
    articleId: string,
    promptId: string,
    patch: {
      status?: 'suggested' | 'saved' | 'answered' | 'rejected'
      userAnswer?: string
      prompt?: string
    },
  ): Promise<LearningLayer> {
    if (
      patch.status === undefined &&
      patch.userAnswer === undefined &&
      patch.prompt === undefined
    ) {
      throw new BadRequestException('Nothing to update')
    }
    if (patch.prompt !== undefined && patch.prompt.trim().length === 0) {
      throw new BadRequestException('Prompt text cannot be empty')
    }
    await this.findOwnedArticle(userId, articleId)
    return this.withLockedLearningLayer(articleId, (layer) => {
      const prompts = { ...(layer.v3Review?.prompts ?? {}) }
      const prev = prompts[promptId] ?? { status: 'suggested' as const }
      const nextAnswer = patch.userAnswer ?? prev.userAnswer
      if (
        patch.status === 'answered' &&
        (nextAnswer === undefined || nextAnswer.trim().length === 0)
      ) {
        throw new BadRequestException('An answer is required to mark answered')
      }
      prompts[promptId] = {
        ...prev,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.userAnswer !== undefined
          ? { userAnswer: patch.userAnswer }
          : {}),
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
      }
      return { ...layer, v3Review: { ...(layer.v3Review ?? {}), prompts } }
    })
  }

  /**
   * Create the INBOX "to learn" Concept for a validated candidate (DET-283),
   * inside the caller's transaction. Source-preserving provenance: `sourceText`
   * is the VERBATIM text of the cited source blocks (pinned blocksVersion, in
   * source order) — the AI definition lives only in `summary`. The concept then
   * flows through the normal inbox → articulation → promotion gate; nothing here
   * touches the earned (PERMANENT) layer.
   */
  private async createConceptFromCandidate(
    tx: Prisma.TransactionClient,
    userId: string,
    workspaceId: string,
    sourceId: string,
    blocksVersion: number,
    articleId: string,
    candidate: LearningConceptCandidate,
  ): Promise<string> {
    const source = await tx.transformerSource.findUnique({
      where: { id: sourceId },
      select: { type: true, url: true },
    })
    const blocks = await tx.transformerSourceBlock.findMany({
      where: {
        sourceId,
        version: blocksVersion,
        id: { in: candidate.sourceBlockIds },
      },
      orderBy: { orderIndex: 'asc' },
      select: { text: true },
    })
    const captureSource: Record<TransformerSourceType, CaptureSource> = {
      TEXT: 'PASTE',
      URL: 'URL',
      PDF: 'PDF',
    }
    const created = await tx.concept.create({
      data: {
        title: candidate.label,
        summary: candidate.definition,
        sourceText: blocks.length
          ? blocks.map((b) => b.text).join('\n\n')
          : candidate.definition,
        sourceUrl: source?.url ?? undefined,
        captureSource: source ? captureSource[source.type] : undefined,
        originArticleId: articleId,
        userId,
        workspaceId,
      },
    })
    await this.conceptState.recordCapture(
      created.id,
      userId,
      tx,
      'Validated from article concept candidate (DET-283)',
    )
    return created.id
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
