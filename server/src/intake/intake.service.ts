import { ConceptStatus } from '@kibadist/prisma'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { PrismaService } from '../prisma/prisma.service'
import { SearchService } from '../search/search.service'
import { SourceQaService } from '../source-qa/source-qa.service'
import type { SaveAnswersDto } from './dto/save-answers.dto'
import {
  buildInterrogatorPrompt,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  parseQuestions,
} from './interrogator.prompt'

/** Above this cosine similarity to an existing concept, treat the topic as
 *  familiar and steer questions toward connection/contrast. */
const FAMILIAR_THRESHOLD = 0.5
const RELATED_LIMIT = 5

export interface IntakeQuestionDto {
  id: string
  conceptId: string
  prompt: string
  kind: string | null
  answer: string | null
  order: number
}

/**
 * The AI Intake Interrogator (DET-188). Generates probing questions for an
 * inbox item and stores the user's own-words answers. The AI only ever produces
 * questions (metadata); it never writes the answer or any canonical note.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly search: SearchService,
    private readonly sourceQa: SourceQaService,
  ) {}

  /**
   * Returns the interrogation for an inbox item, generating it on first open.
   * Idempotent: once questions exist they are returned as-is (we never silently
   * regenerate and lose the user's answers).
   */
  async getOrGenerate(
    userId: string,
    conceptId: string,
  ): Promise<IntakeQuestionDto[]> {
    const concept = await this.requireInboxConcept(userId, conceptId)

    const existing = await this.list(userId, conceptId)
    if (existing.length > 0) return existing

    const source = (concept.sourceText ?? '').trim()
    if (!source) {
      throw new BadRequestException('This item has no content to interrogate')
    }

    const { relatedTitles, familiar } = await this.relatedContext(
      userId,
      source,
    )
    // Read-only feed-forward (DET-208): any reference Q&A the user already
    // explored becomes context so the interrogator probes deeper rather than
    // re-asking. Best-effort — never block interrogation if this read fails.
    let priorQa: { questionText: string; answerText: string }[] = []
    try {
      priorQa = await this.sourceQa.recentForContext(userId, conceptId)
    } catch (error) {
      this.logger.warn(
        `Prior Q&A context lookup failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    const { system, prompt } = buildInterrogatorPrompt({
      source,
      relatedTitles,
      familiar,
      priorQa,
    })

    let text: string
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0.5,
        maxTokens: 700,
      })
      text = result.text
    } catch (error) {
      this.logger.warn(
        `Interrogator generation failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw new ServiceUnavailableException(
        'The interrogator is unavailable right now — try again shortly',
      )
    }

    const parsed = parseQuestions(text).slice(0, MAX_QUESTIONS)
    if (parsed.length < MIN_QUESTIONS) {
      throw new ServiceUnavailableException(
        'The interrogator did not return enough questions — try again',
      )
    }

    await this.prisma.intakeQuestion.createMany({
      data: parsed.map((q, i) => ({
        conceptId,
        userId,
        prompt: q.question,
        kind: q.kind,
        order: i,
      })),
    })

    return this.list(userId, conceptId)
  }

  /** Questions + answers for an inbox item the user owns (404 otherwise) — the
   *  read path used by the controller, kept consistent with inbox/concepts. */
  async get(userId: string, conceptId: string): Promise<IntakeQuestionDto[]> {
    await this.requireInboxConcept(userId, conceptId)
    return this.list(userId, conceptId)
  }

  /** Lists the stored questions + answers for an inbox item, in order. */
  async list(userId: string, conceptId: string): Promise<IntakeQuestionDto[]> {
    const rows = await this.prisma.intakeQuestion.findMany({
      where: { conceptId, userId },
      orderBy: { order: 'asc' },
    })
    return rows.map((r) => ({
      id: r.id,
      conceptId: r.conceptId,
      prompt: r.prompt,
      kind: r.kind,
      answer: r.answer,
      order: r.order,
    }))
  }

  /** Saves the user's own-words answers. Never touches the AI prompts. */
  async saveAnswers(
    userId: string,
    conceptId: string,
    dto: SaveAnswersDto,
  ): Promise<IntakeQuestionDto[]> {
    await this.requireInboxConcept(userId, conceptId)

    await this.prisma.$transaction(
      dto.answers.map(({ questionId, answer }) =>
        this.prisma.intakeQuestion.updateMany({
          // Scope by conceptId + userId so a caller can't write another item's
          // (or user's) questions by guessing an id.
          where: { id: questionId, conceptId, userId },
          data: { answer },
        }),
      ),
    )

    return this.list(userId, conceptId)
  }

  /** Loads an inbox-status concept the user owns, or throws NotFound. */
  private async requireInboxConcept(userId: string, conceptId: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId, status: ConceptStatus.INBOX },
      select: { id: true, sourceText: true },
    })
    if (!concept) throw new NotFoundException('Inbox item not found')
    return concept
  }

  /** Semantic-similarity context for adaptive questioning. Best-effort: if the
   *  AI/search layer is down, fall back to "novel" so generation still works. */
  private async relatedContext(
    userId: string,
    source: string,
  ): Promise<{ relatedTitles: string[]; familiar: boolean }> {
    let matches: { conceptId: string; similarity: number }[] = []
    try {
      matches = await this.search.searchArticulations(
        userId,
        source,
        RELATED_LIMIT,
      )
    } catch (error) {
      // Best-effort: adaptivity is a layer on the (optional) embeddings seam.
      // If it's down, fall back to novel-mode questions rather than failing the
      // whole interrogation — but log it, since persistent silence would hide a
      // degraded provider.
      this.logger.warn(
        `Related-concept lookup failed; treating topic as novel: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return { relatedTitles: [], familiar: false }
    }
    if (matches.length === 0) return { relatedTitles: [], familiar: false }

    const ids = [...new Set(matches.map((m) => m.conceptId))]
    const concepts = await this.prisma.concept.findMany({
      where: { id: { in: ids }, userId, status: { not: ConceptStatus.INBOX } },
      select: { title: true },
    })
    const relatedTitles = concepts.map((c) => c.title)
    // searchArticulations orders by ascending cosine distance (descending
    // similarity), so the first match is the closest.
    const maxSimilarity = matches[0]?.similarity ?? 0
    const familiar =
      maxSimilarity >= FAMILIAR_THRESHOLD && relatedTitles.length > 0
    return { relatedTitles, familiar }
  }
}
