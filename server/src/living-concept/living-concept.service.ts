import {
  Generator,
  type LivingConcept,
  LivingConceptStatus,
} from '@kibadist/prisma'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateLivingConceptDto } from './dto/create-living-concept.dto'
import type { UpdateLivingConceptDto } from './dto/update-living-concept.dto'
import {
  buildLivingConceptPrompt,
  type LivingConceptDraft,
  parseLivingConceptDraft,
} from './living-concept.prompt'

/** How many recent articulations seed the persona. */
const SEED_ARTICULATION_LIMIT = 3

/**
 * Living Concepts (DET-230): lightweight AI-assisted persona scaffolds over
 * concepts the user has ALREADY earned. HARD BOUNDARY — a persona can only attach
 * to a non-INBOX concept, is born DRAFT, and its text NEVER becomes an
 * Articulation or the concept's canonical summary. Seeding degrades gracefully:
 * if AI is unavailable the persona falls back to a deterministic stub rather than
 * failing, so the feature never 500s because the model is down.
 */
@Injectable()
export class LivingConceptService {
  private readonly logger = new Logger(LivingConceptService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
    private readonly ai: AiService,
  ) {}

  /**
   * Seed (or return the existing) persona for an earned concept. Idempotent: if a
   * persona already exists it is returned as-is. The concept must be owned and
   * non-INBOX — the proof-of-learning boundary. A persona is always born DRAFT.
   */
  async create(
    userId: string,
    dto: CreateLivingConceptDto,
  ): Promise<LivingConcept> {
    // Proof-of-learning boundary: a persona can only attach to an earned concept.
    await this.concepts.assertOwnedNonInbox(userId, dto.conceptId)

    // A persona already exists for this concept. Idempotent for a live persona
    // (returned as-is). An ARCHIVED persona is retired, not gone: re-creating it
    // REVIVES it to DRAFT rather than returning the dead row, so "Create Living
    // Concept" on a concept with an archived persona is never a dead end (DET-227).
    const existing = await this.prisma.livingConcept.findUnique({
      where: { conceptId: dto.conceptId },
    })
    if (existing) {
      if (existing.status === LivingConceptStatus.ARCHIVED) {
        return this.prisma.livingConcept.update({
          where: { id: existing.id },
          data: { status: LivingConceptStatus.DRAFT },
        })
      }
      return existing
    }

    const concept = await this.prisma.concept.findFirst({
      where: { id: dto.conceptId, userId },
      select: { title: true, summary: true },
    })
    if (!concept) throw new NotFoundException('Concept not found')

    const articulations = await this.prisma.articulation.findMany({
      where: { conceptId: dto.conceptId, userId },
      orderBy: { createdAt: 'desc' },
      take: SEED_ARTICULATION_LIMIT,
      select: { body: true },
    })
    const articulationBodies = articulations
      .map((a) => a.body.trim())
      .filter((body) => body.length > 0)

    const { draft, createdBy } = await this.seedDraft(
      concept.title,
      concept.summary,
      articulationBodies,
    )

    return this.prisma.livingConcept.create({
      data: {
        conceptId: dto.conceptId,
        userId,
        personaName: draft.personaName,
        personaSummary: draft.personaSummary,
        voice: draft.voice,
        coreMetaphor: draft.coreMetaphor,
        metaphorBreaks: draft.metaphorBreaks,
        // Always born DRAFT — only the user can validate a persona.
        createdBy,
      },
    })
  }

  /** The persona for a concept the user owns, or null if none exists. */
  async findForConcept(
    userId: string,
    conceptId: string,
  ): Promise<LivingConcept | null> {
    await this.concepts.assertOwned(userId, conceptId)
    return this.prisma.livingConcept.findFirst({
      where: { conceptId, userId },
    })
  }

  /**
   * Edit a persona scaffold the user owns. status=USER_VALIDATED is how the user
   * vouches for the persona. Only provided fields are written; persona text is
   * metadata and never flows into Articulation/summary.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateLivingConceptDto,
  ): Promise<LivingConcept> {
    const existing = await this.prisma.livingConcept.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!existing) throw new NotFoundException('Living concept not found')

    return this.prisma.livingConcept.update({
      where: { id },
      data: {
        personaName: dto.personaName,
        personaSummary: dto.personaSummary,
        voice: dto.voice,
        coreMetaphor: dto.coreMetaphor,
        metaphorBreaks: dto.metaphorBreaks,
        status: dto.status,
      },
    })
  }

  /**
   * Produce the seed persona. Tries the AI seeder; on ANY failure (unavailable,
   * throttled, unparseable) falls back to a DETERMINISTIC stub so creation never
   * 500s because the model is down. The AI path is tagged createdBy=AI, the stub
   * createdBy=USER (hand-authorable scaffold), but both are persisted DRAFT.
   */
  private async seedDraft(
    title: string,
    summary: string | null,
    articulations: string[],
  ): Promise<{ draft: LivingConceptDraft; createdBy: Generator }> {
    try {
      const { system, prompt } = buildLivingConceptPrompt({
        title,
        summary,
        articulations,
      })
      const result = await this.ai.complete({
        system,
        prompt,
        // Low temperature keeps the persona sober and on-ethos; at 0.7 the model
        // drifted into chirpy "Hi there! I'm your go-to guide" chatbot voice the
        // product explicitly avoids (DET-228).
        temperature: 0.3,
        maxTokens: 500,
      })
      const draft = parseLivingConceptDraft(result.text)
      if (draft) return { draft, createdBy: Generator.AI }
      this.logger.warn(
        `Persona seeding returned unusable output for "${title}"; using stub`,
      )
    } catch (error) {
      this.logger.warn(
        `Persona seeding failed for "${title}"; using stub: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    return {
      draft: this.stubDraft(title, summary, articulations),
      createdBy: Generator.USER,
    }
  }

  /**
   * The deterministic fallback persona: personaName = title; personaSummary =
   * summary ?? first articulation ?? a default line. Other fields null. This is
   * the honest degraded state when AI is unavailable.
   */
  private stubDraft(
    title: string,
    summary: string | null,
    articulations: string[],
  ): LivingConceptDraft {
    const personaSummary =
      summary?.trim() ||
      articulations[0]?.trim() ||
      `A concept you've earned: ${title}.`
    return {
      personaName: title,
      personaSummary,
      voice: null,
      coreMetaphor: null,
      metaphorBreaks: null,
    }
  }
}
