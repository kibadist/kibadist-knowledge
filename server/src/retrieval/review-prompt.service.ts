import type { ReviewPrompt as PrismaReviewPrompt } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateReviewPromptDto } from './dto/create-review-prompt.dto'

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
