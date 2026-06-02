import { CaptureSource, ConceptStatus, type Prisma } from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

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
import type { CaptureTextDto } from './dto/capture-text.dto'
import type { CaptureUrlDto } from './dto/capture-url.dto'
import { extractPdfText } from './pdf-extract.util'
import { fetchReadable } from './url-fetch.util'

const EXCERPT_CHARS = 240

/** A captured, unprocessed item as shown in the inbox — never a "concept". */
export interface InboxItem {
  id: string
  title: string
  captureSource: CaptureSource | null
  sourceUrl: string | null
  excerpt: string
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
  ) {}

  async captureText(
    userId: string,
    workspaceId: string,
    dto: CaptureTextDto,
  ): Promise<InboxItem> {
    const title = dto.title?.trim() || deriveTitle(dto.text)
    return this.store(userId, workspaceId, {
      title,
      sourceText: dto.text,
      sourceDocument: extractTextDocument(dto.text),
      captureSource: CaptureSource.PASTE,
      trackId: dto.trackId,
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
    return this.store(userId, workspaceId, {
      title,
      sourceText: text || page.text,
      sourceDocument: document,
      sourceUrl: dto.url,
      captureSource: CaptureSource.URL,
      trackId: dto.trackId,
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
    return this.store(userId, workspaceId, {
      title,
      sourceText: text,
      sourceDocument: extractPdfDocument(text),
      captureSource: CaptureSource.PDF,
      trackId,
    })
  }

  /** Lists only INBOX items (never earned concepts), newest first. */
  async list(userId: string, workspaceId: string): Promise<InboxItem[]> {
    const rows = await this.prisma.concept.findMany({
      where: { userId, workspaceId, status: ConceptStatus.INBOX },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        sourceText: true,
        captureSource: true,
        sourceUrl: true,
        createdAt: true,
      },
    })
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      captureSource: r.captureSource,
      sourceUrl: r.sourceUrl,
      excerpt: excerpt(r.sourceText),
      createdAt: r.createdAt,
    }))
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
        createdAt: true,
      },
    })
    if (!row) throw new NotFoundException('Inbox item not found')
    return {
      id: row.id,
      title: row.title,
      captureSource: row.captureSource,
      sourceUrl: row.sourceUrl,
      sourceText: row.sourceText,
      sourceDocument: asSourceDocument(row.sourceDocument),
      excerpt: excerpt(row.sourceText),
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
          targetTrackId,
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
      return created
    })
    return {
      id: concept.id,
      title: concept.title,
      captureSource: concept.captureSource,
      sourceUrl: concept.sourceUrl,
      excerpt: excerpt(concept.sourceText),
      createdAt: concept.createdAt,
    }
  }
}

function excerpt(text: string | null): string {
  if (!text) return ''
  const trimmed = text.trim()
  return trimmed.length > EXCERPT_CHARS
    ? `${trimmed.slice(0, EXCERPT_CHARS)}…`
    : trimmed
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
