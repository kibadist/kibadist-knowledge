import { CaptureSource, ConceptStatus } from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
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

/**
 * The Capture Inbox (DET-187). Captures raw material into a deliberate holding
 * area — a `Concept` in `INBOX` status. Nothing here is knowledge yet: capture
 * never embeds, links, tags, summarizes, or schedules retrieval. Promotion to a
 * permanent concept is a separate, user-driven step (later tickets).
 */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async captureText(userId: string, dto: CaptureTextDto): Promise<InboxItem> {
    const title = dto.title?.trim() || deriveTitle(dto.text)
    return this.store(userId, {
      title,
      sourceText: dto.text,
      captureSource: CaptureSource.PASTE,
    })
  }

  async captureUrl(userId: string, dto: CaptureUrlDto): Promise<InboxItem> {
    const page = await fetchReadable(dto.url)
    const title = page.title?.trim() || hostPathLabel(dto.url)
    return this.store(userId, {
      title,
      // Raw extracted text only; provenance lives in `sourceUrl` (no need to
      // duplicate the URL into the body when extraction comes back empty).
      sourceText: page.text,
      sourceUrl: dto.url,
      captureSource: CaptureSource.URL,
    })
  }

  async capturePdf(
    userId: string,
    filename: string,
    buffer: Buffer,
  ): Promise<InboxItem> {
    const text = await extractPdfText(buffer)
    const title =
      filename
        .replace(/\.pdf$/i, '')
        .trim()
        .slice(0, 200) || 'PDF'
    return this.store(userId, {
      title,
      sourceText: text,
      captureSource: CaptureSource.PDF,
    })
  }

  /** Lists only INBOX items (never earned concepts), newest first. */
  async list(userId: string): Promise<InboxItem[]> {
    const rows = await this.prisma.concept.findMany({
      where: { userId, status: ConceptStatus.INBOX },
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

  /** Discards an inbox item. Only INBOX items can be discarded this way. */
  async discard(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.concept.deleteMany({
      where: { id, userId, status: ConceptStatus.INBOX },
    })
    if (count === 0) throw new NotFoundException('Inbox item not found')
  }

  private async store(
    userId: string,
    data: {
      title: string
      sourceText: string
      captureSource: CaptureSource
      sourceUrl?: string
    },
  ): Promise<InboxItem> {
    const concept = await this.prisma.concept.create({
      data: {
        userId,
        title: data.title,
        sourceText: data.sourceText,
        captureSource: data.captureSource,
        sourceUrl: data.sourceUrl ?? null,
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
