import {
  CandidateImportance,
  CandidateKind,
  type CandidatePromotionStatus,
  ChunkImportance,
  ChunkKind,
  ConceptStatus,
  Generator,
  type Prisma,
} from '@kibadist/prisma'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  asSourceDocument,
  type ConceptChunk,
  chunkDocument,
} from '../source-document/source-document'
import {
  buildConceptLibraryPrompt,
  type ConceptLibraryPromptChunk,
  type ParsedChunkClassification,
  parseConceptLibrary,
} from './concept-library.prompt'

/** A persisted chunk in the library, ordered by reading position. */
export interface SourceChunkDto {
  id: string
  conceptId: string
  title: string | null
  summary: string | null
  blockIds: string[]
  kind: ChunkKind
  importance: ChunkImportance
  position: number
}

/** A persisted candidate concept (scaffold — NEVER an earned Concept). */
export interface SourceConceptCandidateDto {
  id: string
  conceptId: string
  chunkId: string | null
  label: string
  definition: string | null
  aliases: string[]
  sourceBlockIds: string[]
  kind: CandidateKind
  importance: CandidateImportance
  generatedBy: Generator
  promotionStatus: CandidatePromotionStatus
}

/** The full persisted library for an inbox item. */
export interface ConceptLibraryDto {
  conceptId: string
  chunks: SourceChunkDto[]
  candidates: SourceConceptCandidateDto[]
  // Soft-deleted candidates (DET-309): dismissal hides a candidate from the
  // active list but never discards it, so the user can restore one cut by
  // mistake. Surfaced separately for a collapsed "Dismissed" group.
  dismissedCandidates: SourceConceptCandidateDto[]
}

/** Plain text of a chunk's blocks, for the classification prompt. */
function chunkText(chunk: ConceptChunk): string {
  return chunk.blocks
    .map((b) => {
      switch (b.type) {
        case 'heading':
        case 'code':
          return b.text
        case 'paragraph':
        case 'quote':
          return b.runs.map((r) => r.text).join('')
        case 'list':
          return b.items.map((it) => it.map((r) => r.text).join('')).join('\n')
        case 'table':
          return b.rows.map((r) => r.join(' | ')).join('\n')
        case 'image':
          return b.caption ?? b.alt ?? ''
      }
    })
    .join('\n')
    .trim()
}

/**
 * The Concept Library (DET-211). Turns a captured article into a small library of
 * classified, section-sized chunks and the candidate concepts inside them, so the
 * user can study the article as distinct cognitive objects.
 *
 * THE HARD INVARIANT — enforced here and asserted in the spec: every chunk and
 * candidate this service produces is SCAFFOLD / source material. It is NEVER an
 * earned Concept and never enters the permanent graph. This service writes ONLY
 * SourceChunk + SourceConceptCandidate rows; it never creates or modifies a
 * Concept row. Promotion to knowledge happens exclusively through the
 * Proof-of-Learning gate (DET-189), driven by the user articulating, connecting,
 * retrieving, and validating. A candidate's `definition` is a source-grounded
 * comprehension aid shown as CONTEXT — it must never prefill the user's canonical
 * articulation (DET-190).
 */
@Injectable()
export class ConceptLibraryService {
  private readonly logger = new Logger(ConceptLibraryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /**
   * Build (or rebuild) the library for an inbox item. Runs the deterministic
   * chunker for boundaries, then asks the AI to classify chunks + extract
   * candidates. In one transaction it REPLACES this concept's existing chunks +
   * candidates (delete-then-insert) so regeneration is idempotent. On AI failure
   * it still persists the deterministic chunks (OTHER / SUPPORTING) with zero
   * candidates, so the library degrades gracefully. Never touches a Concept row.
   */
  async generate(
    userId: string,
    conceptId: string,
  ): Promise<ConceptLibraryDto> {
    const concept = await this.requireInboxConcept(userId, conceptId)
    const doc = asSourceDocument(concept.sourceDocument)
    if (!doc) {
      // No structured source to chunk: clear any stale library and return empty.
      await this.replaceLibrary(userId, conceptId, [], [])
      return { conceptId, chunks: [], candidates: [], dismissedCandidates: [] }
    }

    const chunks = chunkDocument(doc)
    if (chunks.length === 0) {
      await this.replaceLibrary(userId, conceptId, [], [])
      return { conceptId, chunks: [], candidates: [], dismissedCandidates: [] }
    }

    // Classify chunks + extract candidates. The classification, by index, maps
    // back onto the deterministic chunk boundaries — the AI never re-segments.
    const classifications = await this.classify(conceptId, doc.title, chunks)
    const byIndex = new Map<number, ParsedChunkClassification>(
      classifications.map((c) => [c.index, c]),
    )

    const chunkRows: Prisma.SourceChunkCreateManyInput[] = chunks.map(
      (chunk, position) => {
        const classified = byIndex.get(position)
        return {
          conceptId,
          userId,
          title: chunk.title,
          blockIds: chunk.blockIds,
          kind: classified?.kind ?? ChunkKind.OTHER,
          importance: classified?.importance ?? ChunkImportance.SUPPORTING,
          position,
          // Segmentation is deterministic (SYSTEM); only the classification +
          // candidates below are AI-authored.
          generatedBy: Generator.SYSTEM,
        }
      },
    )

    // Candidates are keyed to their chunk's block ids (the chunk rows are created
    // inside the transaction, so we wire chunkId after their insert by position).
    const candidateSeeds = chunks.flatMap((chunk, position) => {
      const classified = byIndex.get(position)
      if (!classified) return []
      return classified.candidates.map((cand) => ({
        position,
        blockIds: chunk.blockIds,
        label: cand.label,
        definition: cand.definition ?? null,
        kind: cand.kind,
        importance: cand.importance,
      }))
    })

    await this.replaceLibrary(userId, conceptId, chunkRows, candidateSeeds)
    // Read back the persisted rows directly (not via library(), which would
    // re-trigger generation) so a freshly-built library is returned as-is.
    return this.read(conceptId, userId)
  }

  /**
   * Read the persisted library for an inbox item: chunks (ordered by position) +
   * candidates (excluding DISMISSED). Generates on first access if nothing has
   * been persisted yet.
   */
  async library(userId: string, conceptId: string): Promise<ConceptLibraryDto> {
    const concept = await this.requireInboxConcept(userId, conceptId)
    const persisted = await this.read(conceptId, userId)
    if (persisted.chunks.length > 0) return persisted
    // Nothing persisted. Only spend a generate pass when there is actually a
    // structured document to chunk — an item with no sourceDocument has an
    // empty library by definition, so we return it without re-running generate
    // (and its transaction) on every read.
    if (!asSourceDocument(concept.sourceDocument)) {
      return { conceptId, chunks: [], candidates: [], dismissedCandidates: [] }
    }
    return this.generate(userId, conceptId)
  }

  /** Read persisted chunks + non-dismissed candidates for an item (no I/O guard;
   *  callers own the ownership check). */
  private async read(
    conceptId: string,
    userId: string,
  ): Promise<ConceptLibraryDto> {
    const chunks = await this.prisma.sourceChunk.findMany({
      where: { conceptId, userId },
      orderBy: { position: 'asc' },
    })
    const candidates = await this.prisma.sourceConceptCandidate.findMany({
      where: { conceptId, userId, promotionStatus: { not: 'DISMISSED' } },
      orderBy: { createdAt: 'asc' },
    })
    // Dismissed candidates are soft-deleted (DET-309), not gone — read them back
    // separately so the client can offer a restorable "Dismissed" group.
    const dismissed = await this.prisma.sourceConceptCandidate.findMany({
      where: { conceptId, userId, promotionStatus: 'DISMISSED' },
      orderBy: { createdAt: 'asc' },
    })
    return {
      conceptId,
      chunks: chunks.map((c) => this.toChunkDto(c)),
      candidates: candidates.map((c) => this.toCandidateDto(c)),
      dismissedCandidates: dismissed.map((c) => this.toCandidateDto(c)),
    }
  }

  /** Dismiss a candidate (ownership-checked). Flips status to DISMISSED so it no
   *  longer surfaces in the library. Never touches a Concept row. */
  async dismiss(userId: string, candidateId: string): Promise<void> {
    const updated = await this.prisma.sourceConceptCandidate.updateMany({
      where: { id: candidateId, userId },
      data: { promotionStatus: 'DISMISSED' },
    })
    if (updated.count === 0) {
      throw new NotFoundException('Candidate not found')
    }
  }

  /** Restore a previously dismissed candidate (DET-309). Flips DISMISSED back to
   *  CANDIDATE so it surfaces in the library again. Ownership-checked and scoped
   *  to currently-dismissed rows only, so it can never un-promote (PROMOTED) or
   *  touch a Concept row. */
  async restore(userId: string, candidateId: string): Promise<void> {
    const updated = await this.prisma.sourceConceptCandidate.updateMany({
      where: { id: candidateId, userId, promotionStatus: 'DISMISSED' },
      data: { promotionStatus: 'CANDIDATE' },
    })
    if (updated.count === 0) {
      throw new NotFoundException('Dismissed candidate not found')
    }
  }

  /** Run the AI classification pass; returns [] on failure so callers degrade to
   *  deterministic chunks rather than blocking the library. */
  private async classify(
    conceptId: string,
    title: string | undefined,
    chunks: ConceptChunk[],
  ): Promise<ParsedChunkClassification[]> {
    const promptChunks: ConceptLibraryPromptChunk[] = chunks.map(
      (chunk, index) => ({
        index,
        title: chunk.title,
        text: chunkText(chunk),
      }),
    )
    const { system, prompt } = buildConceptLibraryPrompt({
      title,
      chunks: promptChunks,
    })
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0.2,
        maxTokens: 2000,
      })
      return parseConceptLibrary(result.text, chunks.length).chunks
    } catch (error) {
      this.logger.warn(
        `Concept Library classification failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }

  /**
   * Atomically replace this concept's library rows. Delete-then-insert keeps
   * regeneration idempotent (a re-run never duplicates or strands rows). Candidate
   * rows are wired to their chunk's persisted id by reading the inserted chunks
   * back by position. NEVER writes a Concept row.
   */
  private async replaceLibrary(
    userId: string,
    conceptId: string,
    chunkRows: Prisma.SourceChunkCreateManyInput[],
    candidateSeeds: {
      position: number
      blockIds: string[]
      label: string
      definition: string | null
      kind: CandidateKind
      importance: CandidateImportance
    }[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.sourceConceptCandidate.deleteMany({
        where: { conceptId, userId },
      })
      await tx.sourceChunk.deleteMany({ where: { conceptId, userId } })

      if (chunkRows.length > 0) {
        await tx.sourceChunk.createMany({ data: chunkRows })
      }
      if (candidateSeeds.length === 0) return

      // Map each chunk's position to its freshly-inserted id so candidates can
      // reference their owning chunk.
      const inserted = await tx.sourceChunk.findMany({
        where: { conceptId, userId },
        select: { id: true, position: true },
      })
      const idByPosition = new Map(inserted.map((c) => [c.position, c.id]))

      await tx.sourceConceptCandidate.createMany({
        data: candidateSeeds.map((seed) => ({
          conceptId,
          userId,
          chunkId: idByPosition.get(seed.position) ?? null,
          label: seed.label,
          definition: seed.definition,
          sourceBlockIds: seed.blockIds,
          kind: seed.kind,
          importance: seed.importance,
          // Extraction is AI-authored scaffold (segmentation stays SYSTEM).
          generatedBy: Generator.AI,
        })),
      })
    })
  }

  /** Inbox-status concept the user owns. Mirrors the source-qa / promotion guard:
   *  the library acts on a captured source before it's earned. */
  private async requireInboxConcept(userId: string, conceptId: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId, status: ConceptStatus.INBOX },
      select: { id: true, sourceDocument: true },
    })
    if (!concept) throw new NotFoundException('Inbox item not found')
    return concept
  }

  private toChunkDto(row: {
    id: string
    conceptId: string
    title: string | null
    summary: string | null
    blockIds: string[]
    kind: ChunkKind
    importance: ChunkImportance
    position: number
  }): SourceChunkDto {
    return {
      id: row.id,
      conceptId: row.conceptId,
      title: row.title,
      summary: row.summary,
      blockIds: row.blockIds,
      kind: row.kind,
      importance: row.importance,
      position: row.position,
    }
  }

  private toCandidateDto(row: {
    id: string
    conceptId: string
    chunkId: string | null
    label: string
    definition: string | null
    aliases: string[]
    sourceBlockIds: string[]
    kind: CandidateKind
    importance: CandidateImportance
    generatedBy: Generator
    promotionStatus: CandidatePromotionStatus
  }): SourceConceptCandidateDto {
    return {
      id: row.id,
      conceptId: row.conceptId,
      chunkId: row.chunkId,
      label: row.label,
      definition: row.definition,
      aliases: row.aliases,
      sourceBlockIds: row.sourceBlockIds,
      kind: row.kind,
      importance: row.importance,
      generatedBy: row.generatedBy,
      promotionStatus: row.promotionStatus,
    }
  }
}
