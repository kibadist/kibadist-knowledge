import {
  AnswerKind,
  ConceptStatus,
  type Prisma,
  QuestionActor,
} from '@kibadist/prisma'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  asSourceDocument,
  documentToPromptContext,
} from '../source-document/source-document'
import type { AskQuestionDto } from './dto/ask-question.dto'
import {
  buildAnswerPrompt,
  coerceCitations,
  parseAnswer,
  type ReferenceCitation,
} from './source-qa.prompt'

export interface SourceQuestionDto {
  id: string
  conceptId: string
  askedBy: QuestionActor
  questionText: string
  answerText: string | null
  answeredBy: QuestionActor | null
  answerKind: AnswerKind | null
  citations: ReferenceCitation[]
  createdAt: Date
}

/** Lightweight read shape for the feed-forward seam (DET-208 → DET-188/DET-190).
 *  Deliberately carries no provenance fluff — just the text downstream prompts
 *  may use as CONTEXT. It is never written into a canonical articulation. */
export interface ReferenceQaContext {
  questionText: string
  answerText: string
}

/** How many prior Q&A pairs we expose as context to later stages. */
const CONTEXT_LIMIT = 8

/**
 * Reference Q&A (DET-208). The user asks questions while reading a source; the
 * AI answers as a source-grounded comprehension SCAFFOLD. These answers are a
 * distinct cognitive layer from earned knowledge:
 *
 * - They are stored as {@link SourceQuestion} rows, never as `Articulation`.
 * - Their `answerKind` is always REFERENCE_SCAFFOLD (AI-authored, un-promotable).
 * - There is no method here, and no caller, that turns a scaffold answer into a
 *   canonical concept or articulation. The Proof-of-Learning Gate is the only
 *   path to knowledge, and it reads user-authored text exclusively.
 *
 * {@link recentForContext} is the read-only feed-forward seam: later stages may
 * DISPLAY or reference prior Q&A, but must produce fresh user-authored cognition.
 */
@Injectable()
export class SourceQaService {
  private readonly logger = new Logger(SourceQaService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /**
   * Ask a question about an inbox source and get a source-grounded reference
   * answer. The answer is persisted as AI-authored scaffold (REFERENCE_SCAFFOLD),
   * which by construction can never become a canonical articulation.
   */
  async ask(
    userId: string,
    conceptId: string,
    dto: AskQuestionDto,
  ): Promise<SourceQuestionDto> {
    const concept = await this.requireInboxConcept(userId, conceptId)
    // Prefer the structured document (DET-210): block-id-annotated context lets
    // the AI attribute citations to specific blocks. Fall back to the flattened
    // raw text for items captured before structured extraction existed.
    const doc = asSourceDocument(concept.sourceDocument)
    const structuredSource = doc ? documentToPromptContext(doc) : ''
    const source = structuredSource || (concept.sourceText ?? '').trim()
    if (!source) {
      throw new BadRequestException('This item has no source text to ask about')
    }

    const { system, prompt } = buildAnswerPrompt({
      source,
      question: dto.questionText,
      structured: Boolean(structuredSource),
    })
    let text: string
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0.2,
        maxTokens: 600,
      })
      text = result.text
    } catch (error) {
      this.logger.warn(
        `Reference answer generation failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw new ServiceUnavailableException(
        'Could not answer right now — try again shortly',
      )
    }

    const parsed = parseAnswer(text)
    if (!parsed) {
      throw new ServiceUnavailableException(
        'Could not produce a reference answer — try again',
      )
    }

    // The answer is AI-authored scaffold. The provenance fields below are the
    // structural guarantee: askedBy=USER, answeredBy=AI, answerKind=SCAFFOLD.
    // Nothing downstream may promote a row in this shape to knowledge.
    const row = await this.prisma.sourceQuestion.create({
      data: {
        conceptId,
        userId,
        askedBy: QuestionActor.USER,
        questionText: dto.questionText,
        answerText: parsed.answer,
        answeredBy: QuestionActor.AI,
        answerKind: AnswerKind.REFERENCE_SCAFFOLD,
        citations: parsed.citations as unknown as Prisma.InputJsonValue,
      },
    })
    return this.toDto(row)
  }

  /** Session history for a source the user owns (404 on a foreign/unknown id). */
  async list(userId: string, conceptId: string): Promise<SourceQuestionDto[]> {
    await this.requireConcept(userId, conceptId)
    const rows = await this.prisma.sourceQuestion.findMany({
      where: { conceptId, userId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => this.toDto(r))
  }

  /** Discard a single Q&A entry the user owns. */
  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.prisma.sourceQuestion.deleteMany({
      where: { id, userId },
    })
    if (deleted.count === 0) {
      throw new NotFoundException('Reference question not found')
    }
  }

  /**
   * Read-only feed-forward: the most recent answered Q&A pairs for a concept, for
   * use as CONTEXT by the Interrogator (DET-188) and Compression (DET-190). This
   * is intentionally minimal and read-only — there is no write counterpart that
   * could route this text into an `Articulation`.
   */
  async recentForContext(
    userId: string,
    conceptId: string,
    limit = CONTEXT_LIMIT,
  ): Promise<ReferenceQaContext[]> {
    const rows = await this.prisma.sourceQuestion.findMany({
      where: { conceptId, userId, answerText: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { questionText: true, answerText: true },
    })
    // Oldest-first so the dialogue reads in order when handed to a prompt.
    return rows.reverse().map((r) => ({
      questionText: r.questionText,
      answerText: r.answerText as string,
    }))
  }

  /** Inbox-status concept the user owns (asking happens while reading an inbox
   *  item). Mirrors the intake/promotion guards. */
  private async requireInboxConcept(userId: string, conceptId: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId, status: ConceptStatus.INBOX },
      select: { id: true, sourceText: true, sourceDocument: true },
    })
    if (!concept) throw new NotFoundException('Inbox item not found')
    return concept
  }

  /** Owner-scoped, status-blind existence check for read paths. */
  private async requireConcept(userId: string, conceptId: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { id: true },
    })
    if (!concept) throw new NotFoundException('Item not found')
    return concept
  }

  private toDto(row: {
    id: string
    conceptId: string
    askedBy: QuestionActor
    questionText: string
    answerText: string | null
    answeredBy: QuestionActor | null
    answerKind: AnswerKind | null
    citations: unknown
    createdAt: Date
  }): SourceQuestionDto {
    return {
      id: row.id,
      conceptId: row.conceptId,
      askedBy: row.askedBy,
      questionText: row.questionText,
      answerText: row.answerText,
      answeredBy: row.answeredBy,
      answerKind: row.answerKind,
      citations: coerceCitations(row.citations),
      createdAt: row.createdAt,
    }
  }
}
