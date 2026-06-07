import { type ReviewPrompt as PrismaReviewPrompt } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateReviewPromptDto } from './dto/create-review-prompt.dto'
import { nextPromptReviewAt } from './review-prompt-schedule'

/** An approved prompt the engine can resurface now — the minimal shape the
 *  session queue builder needs (DET-310). */
export interface DueReviewPrompt {
  id: string
  promptType: string
  nextReviewAt: Date | null
}

/**
 * The snake_case wire shape returned to the client — the `ScheduledReviewPrompt`
 * contract (DET-288), stamped with the server-owned id/schedule/timestamps.
 */
export interface ReviewPromptWire {
  id: string
  user_id: string
  prompt_id: string
  article_id: string
  article_version_id?: string
  section_id?: string
  concept_id?: string
  prompt_type: string
  origin: string
  subject: string
  question: string
  expected_answer_summary: string
  source_span_ids: string[]
  created_from_event_id?: string
  status: string
  next_review_at?: string
  created_at: string
  updated_at: string
}

/**
 * The Retrieval Engine's store for approved review prompts (DET-301).
 *
 * DET-288's Spaced Review mode proposes review prompts built from the learner's
 * own rewrites, comparisons, and validated concepts; on approval the learner
 * hands them here, the real downstream sink. This is distinct from the
 * `article_learning_event` log (DET-278): that records the `review_prompt_approved`
 * ACTION (source of truth, consumed not owned), while this row is the engine's
 * working copy of the prompt it will later surface for recall.
 *
 * Prompts are scoped to the authenticated user. Approval is idempotent: the
 * deterministic `promptId` keys an upsert, so re-approving the same prompt (e.g.
 * after a reload re-generates the Spaced Review set) updates the row in place
 * rather than duplicating it.
 */
@Injectable()
export class ReviewPromptService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every approved prompt this user holds, most recent first. */
  async listForUser(
    userId: string,
    articleId?: string,
  ): Promise<ReviewPromptWire[]> {
    const rows = await this.prisma.reviewPrompt.findMany({
      where: { userId, ...(articleId ? { articleId } : {}) },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map((row) => this.toWire(row))
  }

  /**
   * Approve a review prompt into the engine. Idempotent on (userId, promptId):
   * the learner only ever submits APPROVED prompts, so `status` is set here, not
   * read from the body; `userId` always comes from the JWT. `nextReviewAt` is
   * left null — the engine owns the schedule and assigns the cadence when it
   * picks the prompt up (the unify-session work).
   */
  async approve(
    userId: string,
    dto: CreateReviewPromptDto,
  ): Promise<ReviewPromptWire> {
    const data = {
      userId,
      articleId: dto.article_id,
      articleVersionId: dto.article_version_id ?? null,
      sectionId: dto.section_id ?? null,
      conceptId: dto.concept_id ?? null,
      promptType: dto.prompt_type,
      origin: dto.origin,
      subject: dto.subject,
      question: dto.question,
      expectedAnswerSummary: dto.expected_answer_summary,
      sourceSpanIds: dto.source_span_ids ?? [],
      createdFromEventId: dto.created_from_event_id ?? null,
      status: 'approved' as const,
    }
    const row = await this.prisma.reviewPrompt.upsert({
      where: { userId_promptId: { userId, promptId: dto.prompt_id } },
      create: { ...data, promptId: dto.prompt_id },
      update: data,
    })
    return this.toWire(row)
  }

  /**
   * Approved prompts due for resurfacing in a session (DET-310): status
   * `approved` and either never scheduled (`nextReviewAt` null = immediately due)
   * or whose next review has come. Soonest-due first, nulls leading. Returns the
   * minimal shape the session queue builder + start-screen composition need.
   */
  async dueForUser(userId: string): Promise<DueReviewPrompt[]> {
    const now = new Date()
    const rows = await this.prisma.reviewPrompt.findMany({
      where: {
        userId,
        status: 'approved',
        OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
      },
      orderBy: { nextReviewAt: { sort: 'asc', nulls: 'first' } },
      select: { id: true, promptType: true, nextReviewAt: true },
    })
    return rows
  }

  /** How many approved prompts are due now — for the session-start composition
   *  line, without loading the rows. */
  countDueForUser(userId: string): Promise<number> {
    const now = new Date()
    return this.prisma.reviewPrompt.count({
      where: {
        userId,
        status: 'approved',
        OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
      },
    })
  }

  /**
   * Reschedule a prompt after it was reviewed in a session (DET-310). Scoped to
   * the owner; the new cadence comes from the stateless prompt scheduler. Matches
   * by primary key with the owner in the filter so a caller can't reschedule
   * another user's prompt.
   */
  async reschedule(
    userId: string,
    id: string,
    score: number,
    from: Date = new Date(),
  ): Promise<void> {
    await this.prisma.reviewPrompt.updateMany({
      where: { id, userId },
      data: { nextReviewAt: nextPromptReviewAt(score, from) },
    })
  }

  /** The one camelCase-row → snake_case-contract boundary. */
  private toWire(row: PrismaReviewPrompt): ReviewPromptWire {
    return {
      id: row.id,
      user_id: row.userId,
      prompt_id: row.promptId,
      article_id: row.articleId,
      article_version_id: row.articleVersionId ?? undefined,
      section_id: row.sectionId ?? undefined,
      concept_id: row.conceptId ?? undefined,
      prompt_type: row.promptType,
      origin: row.origin,
      subject: row.subject,
      question: row.question,
      expected_answer_summary: row.expectedAnswerSummary,
      source_span_ids: row.sourceSpanIds,
      created_from_event_id: row.createdFromEventId ?? undefined,
      status: row.status,
      next_review_at: row.nextReviewAt?.toISOString() ?? undefined,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }
  }
}
