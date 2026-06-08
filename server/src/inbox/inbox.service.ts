import {
  type ArticleLearningEventType,
  CaptureSource,
  ConceptStatus,
  type Prisma,
  type TransformedArticleStatus,
} from '@kibadist/prisma'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { ConceptStateService } from '../concept-state/concept-state.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  asSourceDocument,
  type ConceptChunk,
  chunkDocument,
  extractPdfDocument,
  extractTextDocument,
  extractUrlDocument,
  type SourceDocument,
} from '../source-document/source-document'
import { TransformerService } from '../transformer/transformer.service'
import type { CaptureTextDto } from './dto/capture-text.dto'
import type { CaptureUrlDto } from './dto/capture-url.dto'
import { extractPdfText } from './pdf-extract.util'
import { fetchReadable } from './url-fetch.util'

const EXCERPT_CHARS = 240

/** A captured source's progress through the learning loop (DET-316), shown as a
 *  read / recalled / kept glyph on its inbox row. Derived from the latest
 *  article's persisted `article_learning_events`, so triage reflects how far the
 *  source has been understood, not just whether its article is ready. */
export interface InboxLearningStages {
  read: boolean
  recalled: boolean
  kept: boolean
}

/** A captured, unprocessed item as shown in the inbox — never a "concept". */
export interface InboxItem {
  id: string
  title: string
  captureSource: CaptureSource | null
  sourceUrl: string | null
  /** Set when this capture was validated out of a source-preserving article
   *  (DET-283) — drives the inbox's "from article" badge + backlink. */
  originArticleId: string | null
  /** Unified capture (DET-300): the TransformerSource captured alongside this
   *  item, so the row can open the source pipeline. Null for forged merges and
   *  pre-DET-300 captures. */
  sourceId: string | null
  /** The companion source's latest generated article + its status (DET-300),
   *  so a ready article surfaces a "Read" action on the same row. Null until the
   *  pipeline produces an article (or when there's no companion source). */
  latestArticleId: string | null
  latestArticleStatus: TransformedArticleStatus | null
  /** Per-source learning progress (DET-316), derived from the latest article's
   *  events. Null until there's a companion article to have learned from. */
  learning: InboxLearningStages | null
  excerpt: string
  /** Word count of the raw material — a triage signal ("how long is this?").
   *  Derived from sourceText at read time; not persisted. */
  wordCount: number
  createdAt: Date
}

/** A single inbox item with its full raw material (processing view). */
export interface InboxItemDetail extends InboxItem {
  sourceText: string | null
  /** Structured article representation for the Reader (DET-210); null for items
   *  captured before structured extraction existed. */
  sourceDocument: SourceDocument | null
}

/**
 * The Capture Inbox (DET-187). Captures raw material into a deliberate holding
 * area — a `Concept` in `INBOX` status. Nothing here is knowledge yet: capture
 * never embeds, links, tags, summarizes, or schedules retrieval. Promotion to a
 * permanent concept is a separate, user-driven step (later tickets).
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conceptState: ConceptStateService,
    // Unified capture (DET-300): every capture also ingests a TransformerSource so
    // the same row can lead to a magazine-quality article. TransformerModule
    // exports this service; InboxModule imports it (no cycle — Transformer never
    // imports Inbox).
    private readonly transformer: TransformerService,
  ) {}

  async captureText(
    userId: string,
    workspaceId: string,
    dto: CaptureTextDto,
  ): Promise<InboxItem> {
    const title = dto.title?.trim() || deriveTitle(dto.text)
    // Companion TransformerSource (DET-300): same raw text into the article
    // pipeline. Created first so its id can be hard-linked onto the inbox concept.
    const source = await this.transformer.createTextSource(
      userId,
      workspaceId,
      {
        text: dto.text,
        title,
      },
    )
    return this.store(userId, workspaceId, {
      title,
      sourceText: dto.text,
      sourceDocument: extractTextDocument(dto.text),
      captureSource: CaptureSource.PASTE,
      trackId: dto.trackId,
      sourceId: source.id,
    })
  }

  async captureUrl(
    userId: string,
    workspaceId: string,
    dto: CaptureUrlDto,
  ): Promise<InboxItem> {
    const page = await fetchReadable(dto.url)
    // Structured extraction (DET-210) preserves document hierarchy; the
    // block-derived flat text is cleaner (chrome-stripped), so prefer it for
    // sourceText, falling back to the legacy whole-page flatten. The router
    // picks the best extractor per source (Wikipedia API → Readability →
    // hand-rolled heuristic) and may carry a better title than the <title> tag.
    const { document, text } = await extractUrlDocument(dto.url, page.html)
    const title =
      document.title?.trim() || page.title?.trim() || hostPathLabel(dto.url)
    // Companion TransformerSource (DET-300): reuse the page we just fetched so the
    // URL isn't fetched twice.
    const source = await this.transformer.createUrlSourceFromHtml(
      userId,
      workspaceId,
      dto.url,
      page.html,
      page.title,
    )
    return this.store(userId, workspaceId, {
      title,
      sourceText: text || page.text,
      sourceDocument: document,
      sourceUrl: dto.url,
      captureSource: CaptureSource.URL,
      trackId: dto.trackId,
      sourceId: source.id,
    })
  }

  async capturePdf(
    userId: string,
    workspaceId: string,
    filename: string,
    buffer: Buffer,
    trackId?: string,
  ): Promise<InboxItem> {
    const text = await extractPdfText(buffer)
    const title =
      filename
        .replace(/\.pdf$/i, '')
        .trim()
        .slice(0, 200) || 'PDF'
    // Companion TransformerSource (DET-300): hand the PDF bytes to the article
    // pipeline (it re-extracts from the bytes itself).
    const source = await this.transformer.createPdfSource(
      userId,
      workspaceId,
      filename,
      buffer,
    )
    return this.store(userId, workspaceId, {
      title,
      sourceText: text,
      sourceDocument: extractPdfDocument(text),
      captureSource: CaptureSource.PDF,
      trackId,
      sourceId: source.id,
    })
  }

  /** Lists only INBOX items (never earned concepts), newest first. Snoozed
   *  items (DET-241) are hidden until their time passes — null or past = visible,
   *  so snoozes "expire" lazily on read without a cron. */
  async list(userId: string, workspaceId: string): Promise<InboxItem[]> {
    const rows = await this.prisma.concept.findMany({
      where: {
        userId,
        workspaceId,
        status: ConceptStatus.INBOX,
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        sourceText: true,
        captureSource: true,
        sourceUrl: true,
        originArticleId: true,
        sourceId: true,
        createdAt: true,
      },
    })
    // Unified capture (DET-300): batch-resolve the companion sources' latest
    // articles so a ready article can surface a "Read" action on the row.
    const articles = await this.latestArticlesBySource(
      userId,
      rows.map((r) => r.sourceId).filter((id): id is string => id !== null),
    )
    // Per-source learning glyph (DET-316): one batched query over the latest
    // article ids, alongside the article enrichment — not one query per row.
    const stages = await this.learningStagesByArticle(
      userId,
      [...articles.values()].map((a) => a.latestArticleId),
    )
    return rows.map((r) => {
      const article = r.sourceId ? articles.get(r.sourceId) : undefined
      return {
        id: r.id,
        title: r.title,
        captureSource: r.captureSource,
        sourceUrl: r.sourceUrl,
        originArticleId: r.originArticleId,
        sourceId: r.sourceId,
        latestArticleId: article?.latestArticleId ?? null,
        latestArticleStatus: article?.latestArticleStatus ?? null,
        learning: article
          ? (stages.get(article.latestArticleId) ?? null)
          : null,
        excerpt: excerpt(r.sourceText),
        wordCount: countWords(r.sourceText),
        createdAt: r.createdAt,
      }
    })
  }

  /** A single inbox item with its full raw material — for the processing view. */
  async findOne(userId: string, id: string): Promise<InboxItemDetail> {
    const row = await this.prisma.concept.findFirst({
      where: { id, userId, status: ConceptStatus.INBOX },
      select: {
        id: true,
        title: true,
        sourceText: true,
        sourceDocument: true,
        captureSource: true,
        sourceUrl: true,
        originArticleId: true,
        sourceId: true,
        createdAt: true,
      },
    })
    if (!row) throw new NotFoundException('Inbox item not found')
    const article = row.sourceId
      ? (await this.latestArticlesBySource(userId, [row.sourceId])).get(
          row.sourceId,
        )
      : undefined
    const stages = article
      ? await this.learningStagesByArticle(userId, [article.latestArticleId])
      : undefined
    return {
      id: row.id,
      title: row.title,
      captureSource: row.captureSource,
      sourceUrl: row.sourceUrl,
      originArticleId: row.originArticleId,
      sourceId: row.sourceId,
      latestArticleId: article?.latestArticleId ?? null,
      latestArticleStatus: article?.latestArticleStatus ?? null,
      learning: article ? (stages?.get(article.latestArticleId) ?? null) : null,
      sourceText: row.sourceText,
      sourceDocument: asSourceDocument(row.sourceDocument),
      excerpt: excerpt(row.sourceText),
      wordCount: countWords(row.sourceText),
      createdAt: row.createdAt,
    }
  }

  /**
   * The Concept Library (DET-211): an inbox item's structured article split into
   * section-sized learnable chunks. Chunking lives on the inbox item because it
   * acts on a CAPTURED source before it's earned — surfacing the article as
   * distinct cognitive objects so the user can study and recall one at a time
   * instead of re-reading one wall. Reuses findOne's ownership/status guard.
   *
   * Returns [] when the item has no structured document (older capture). The
   * library SURFACES the chunks; per-chunk promotion is the natural next step
   * (it needs schema/flow changes and is out of this slice's scope).
   *
   * NOTE: specifics inferred pending the full DET-211 spec (Linear unfetchable).
   */
  async chunks(userId: string, id: string): Promise<ConceptChunk[]> {
    const row = await this.prisma.concept.findFirst({
      where: { id, userId, status: ConceptStatus.INBOX },
      select: { sourceDocument: true },
    })
    if (!row) throw new NotFoundException('Inbox item not found')
    const doc = asSourceDocument(row.sourceDocument)
    if (!doc) return []
    return chunkDocument(doc)
  }

  /** Discards an inbox item. Only INBOX items can be discarded this way. */
  async discard(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.concept.deleteMany({
      where: { id, userId, status: ConceptStatus.INBOX },
    })
    if (count === 0) throw new NotFoundException('Inbox item not found')
  }

  /**
   * Snooze a captured item out of the inbox until `until` (DET-241). It stays an
   * INBOX item — snooze only hides it from the list/badge until the time passes,
   * at which point the read filter surfaces it again. Scoped to the owner.
   */
  async snooze(userId: string, id: string, until: Date): Promise<void> {
    const { count } = await this.prisma.concept.updateMany({
      where: { id, userId, status: ConceptStatus.INBOX },
      data: { snoozedUntil: until },
    })
    if (count === 0) throw new NotFoundException('Inbox item not found')
  }

  /**
   * Forge several captured fragments into a single inbox item (DET-241). The merge
   * composes their raw material — with a provenance header per fragment — into one
   * new INBOX concept, then CONSUMES the originals (their text lives on inside the
   * merged item, so nothing is lost). The result is a fresh capture ready for the
   * normal interrogation/promotion flow: promotion becomes synthesis of several
   * sources rather than one-fragment-at-a-time. Still no knowledge here — it's raw
   * material until earned through the gate.
   */
  async forge(
    userId: string,
    workspaceId: string,
    ids: string[],
  ): Promise<InboxItem> {
    // De-dupe while preserving the caller's order (the order fragments appear in
    // the merged text).
    const orderedIds = [...new Set(ids)]
    const rows = await this.prisma.concept.findMany({
      where: {
        id: { in: orderedIds },
        userId,
        workspaceId,
        status: ConceptStatus.INBOX,
      },
      select: { id: true, title: true, sourceText: true, sourceUrl: true },
    })
    if (rows.length < 2) {
      throw new BadRequestException(
        'Forge needs at least two of your inbox items',
      )
    }
    const byId = new Map(rows.map((r) => [r.id, r]))
    const fragments = orderedIds
      .map((id) => byId.get(id))
      .filter((r): r is (typeof rows)[number] => Boolean(r))

    // Compose the merged source: each fragment under a provenance header, joined
    // by a horizontal rule so the boundaries survive into the Reader/extractor.
    const mergedText = fragments
      .map((r) => {
        const header = r.sourceUrl ? `${r.title}\n${r.sourceUrl}` : r.title
        return `${header}\n\n${r.sourceText ?? ''}`.trim()
      })
      .join('\n\n———\n\n')
    const title = forgeTitle(fragments.map((r) => r.title))

    const concept = await this.prisma.$transaction(async (tx) => {
      const created = await tx.concept.create({
        data: {
          userId,
          workspaceId,
          title,
          sourceText: mergedText,
          sourceDocument: extractTextDocument(
            mergedText,
          ) as unknown as Prisma.InputJsonValue,
          // A forged item is composed text, not a single-source capture.
          captureSource: CaptureSource.PASTE,
          status: ConceptStatus.INBOX,
        },
        select: {
          id: true,
          title: true,
          sourceText: true,
          captureSource: true,
          sourceUrl: true,
          createdAt: true,
        },
      })
      await this.conceptState.recordCapture(created.id, userId, tx)
      // Consume the originals — atomic with the create, scoped to the owner's
      // still-INBOX rows so a concurrent promotion/discard can't be clobbered.
      await tx.concept.deleteMany({
        where: {
          id: { in: fragments.map((r) => r.id) },
          userId,
          status: ConceptStatus.INBOX,
        },
      })
      return created
    })

    return {
      id: concept.id,
      title: concept.title,
      captureSource: concept.captureSource,
      sourceUrl: concept.sourceUrl,
      // A forge merges raw captures — never article-derived provenance.
      originArticleId: null,
      // A forged item composes existing captures; it has no companion source.
      sourceId: null,
      latestArticleId: null,
      latestArticleStatus: null,
      // No companion article yet, so nothing learned to glyph.
      learning: null,
      excerpt: excerpt(concept.sourceText),
      wordCount: countWords(concept.sourceText),
      createdAt: concept.createdAt,
    }
  }

  /**
   * Validate an optional target-track id (DET-240): null when none was given, the
   * id when it's a track in the active workspace, or NotFound when it isn't. The
   * workspace check is the tenancy guard — a capture can only be routed into a
   * track of the world it's being captured into.
   */
  private async resolveTargetTrack(
    userId: string,
    workspaceId: string,
    trackId?: string,
  ): Promise<string | null> {
    if (!trackId) return null
    const track = await this.prisma.track.findFirst({
      where: { id: trackId, workspaceId, workspace: { ownerUserId: userId } },
      select: { id: true },
    })
    if (!track) throw new NotFoundException('Track not found')
    return track.id
  }

  private async store(
    userId: string,
    workspaceId: string,
    data: {
      title: string
      sourceText: string
      sourceDocument?: SourceDocument
      captureSource: CaptureSource
      sourceUrl?: string
      trackId?: string
      // Unified capture (DET-300): the companion TransformerSource id to hard-link.
      sourceId?: string
    },
  ): Promise<InboxItem> {
    // Track-first onboarding (DET-240): if a target track was given, it must be a
    // track in THIS workspace — otherwise a capture could be routed into another
    // world's track. Validated here so a bad id fails fast at capture rather than
    // silently dropping the routing later, at promotion.
    const targetTrackId = await this.resolveTargetTrack(
      userId,
      workspaceId,
      data.trackId,
    )

    // Create the inbox concept (defaults to SEEN) and write its opening
    // `null → SEEN` transition in one commit, so a captured item's cognitive
    // history starts at the moment of capture and never drifts from its row.
    const concept = await this.prisma.$transaction(async (tx) => {
      const created = await tx.concept.create({
        data: {
          userId,
          workspaceId,
          title: data.title,
          sourceText: data.sourceText,
          sourceDocument: data.sourceDocument
            ? (data.sourceDocument as unknown as Prisma.InputJsonValue)
            : undefined,
          captureSource: data.captureSource,
          sourceUrl: data.sourceUrl ?? null,
          sourceId: data.sourceId ?? null,
          targetTrackId,
          status: ConceptStatus.INBOX,
        },
        select: {
          id: true,
          title: true,
          sourceText: true,
          captureSource: true,
          sourceUrl: true,
          sourceId: true,
          createdAt: true,
        },
      })
      await this.conceptState.recordCapture(created.id, userId, tx)
      return created
    })
    return {
      id: concept.id,
      title: concept.title,
      captureSource: concept.captureSource,
      sourceUrl: concept.sourceUrl,
      // Fresh captures are raw material — article provenance only ever comes
      // from validating an article concept candidate (DET-283).
      originArticleId: null,
      sourceId: concept.sourceId,
      // The companion source's pipeline has only just been fired — no article yet.
      latestArticleId: null,
      latestArticleStatus: null,
      // No companion article yet, so nothing learned to glyph.
      learning: null,
      excerpt: excerpt(concept.sourceText),
      wordCount: countWords(concept.sourceText),
      createdAt: concept.createdAt,
    }
  }

  /**
   * Resolve each inbox item's companion source (DET-300) into its latest generated
   * article + status, batched. Plain id link (no FK relation), so this is a second
   * query keyed by the sources still owned by the user. Returns a map from
   * sourceId → { latestArticleId, latestArticleStatus }; sources with no article
   * yet are simply absent.
   */
  private async latestArticlesBySource(
    userId: string,
    sourceIds: string[],
  ): Promise<
    Map<
      string,
      { latestArticleId: string; latestArticleStatus: TransformedArticleStatus }
    >
  > {
    const ids = [...new Set(sourceIds)]
    if (ids.length === 0) return new Map()
    const sources = await this.prisma.transformerSource.findMany({
      where: { id: { in: ids }, userId },
      select: {
        id: true,
        articles: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
      },
    })
    const map = new Map<
      string,
      { latestArticleId: string; latestArticleStatus: TransformedArticleStatus }
    >()
    for (const s of sources) {
      const latest = s.articles[0]
      if (latest) {
        map.set(s.id, {
          latestArticleId: latest.id,
          latestArticleStatus: latest.status,
        })
      }
    }
    return map
  }

  /**
   * Resolve each latest article's learning-stage glyph (DET-316) in one batched
   * query, reusing the DET-314 stage rule: read once a section was revealed,
   * recalled once a rewrite was submitted AND compared, kept once a concept
   * candidate was approved. Keyed by articleId → {read, recalled, kept}; articles
   * with no events are absent (the row shows an empty glyph). One grouped query
   * over the (articleId, eventType) index, not one per row.
   */
  private async learningStagesByArticle(
    userId: string,
    articleIds: string[],
  ): Promise<Map<string, InboxLearningStages>> {
    const ids = [...new Set(articleIds)]
    if (ids.length === 0) return new Map()
    const rows = await this.prisma.articleLearningEvent.groupBy({
      by: ['articleId', 'eventType'],
      where: { userId, articleId: { in: ids } },
    })
    const typesByArticle = new Map<string, Set<ArticleLearningEventType>>()
    for (const r of rows) {
      const set = typesByArticle.get(r.articleId) ?? new Set()
      set.add(r.eventType)
      typesByArticle.set(r.articleId, set)
    }
    const map = new Map<string, InboxLearningStages>()
    for (const [articleId, types] of typesByArticle) {
      map.set(articleId, {
        read: types.has('section_revealed'),
        recalled:
          types.has('block_rewrite_submitted') &&
          types.has('comparison_generated'),
        kept: types.has('concept_candidate_approved'),
      })
    }
    return map
  }
}

function excerpt(text: string | null): string {
  if (!text) return ''
  const trimmed = text.trim()
  return trimmed.length > EXCERPT_CHARS
    ? `${trimmed.slice(0, EXCERPT_CHARS)}…`
    : trimmed
}

/** Rough word count over the raw material — feeds the inbox's read-time signal. */
function countWords(text: string | null): number {
  if (!text) return 0
  const matches = text.trim().match(/\S+/g)
  return matches ? matches.length : 0
}

/** Title for a forged item: the first fragment's title, plus "+ N more". The
 *  first title is capped so the "+ N more" suffix always survives. */
function forgeTitle(titles: string[]): string {
  const rest = titles.length - 1
  const first = (titles[0]?.trim() || 'Untitled').slice(0, 80)
  return rest > 0 ? `${first} + ${rest} more` : first.slice(0, 120)
}

function deriveTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return 'Untitled capture'
  return firstLine.slice(0, 120)
}

function hostPathLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 200)
  } catch {
    return rawUrl.slice(0, 200)
  }
}
