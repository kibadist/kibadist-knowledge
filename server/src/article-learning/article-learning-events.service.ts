import type {
  Prisma,
  ArticleLearningEvent as PrismaArticleLearningEvent,
} from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type {
  ArticleLearningEvent,
  ArticleLearningFeedback,
} from './article-learning.types'
import type { CreateArticleLearningEventDto } from './dto/create-article-learning-event.dto'

/**
 * Persistence for the `article_learning_events` log (DET-301).
 *
 * DET-278 makes this log the SOURCE OF TRUTH for a learner's activity against a
 * generated article — owned here, consumed (never owned) by the Concept Library
 * and Retrieval Engine. Until DET-301 the only writer was the in-memory store on
 * `/deep-reading/demo`; now Deep Reading Mode on a real transformed article
 * hydrates from and appends to this table, so completion markers survive a
 * reload.
 *
 * Events are scoped to the authenticated user. The wire shape is the snake_case
 * DET-278 contract (see `article-learning.types.ts`); `toWire` is the single
 * adaptation boundary from the camelCase Prisma row.
 */
@Injectable()
export class ArticleLearningEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every event this user logged against an article, oldest first (so the
   *  client store replays them in the order they happened). */
  async listForUser(
    userId: string,
    articleId: string,
  ): Promise<ArticleLearningEvent[]> {
    const rows = await this.prisma.articleLearningEvent.findMany({
      where: { userId, articleId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((row) => this.toWire(row))
  }

  /** Append one event for this user. `user_id` is always the JWT subject — a
   *  client-supplied user is ignored, so a learner can only write their own log. */
  async create(
    userId: string,
    dto: CreateArticleLearningEventDto,
  ): Promise<ArticleLearningEvent> {
    const row = await this.prisma.articleLearningEvent.create({
      data: {
        userId,
        articleId: dto.article_id,
        articleVersionId: dto.article_version_id ?? null,
        sectionId: dto.section_id ?? null,
        blockId: dto.block_id ?? null,
        sourceSpanIds: dto.source_span_ids ?? [],
        eventType: dto.event_type,
        prompt: dto.prompt ?? null,
        userAnswer: dto.user_answer ?? null,
        aiFeedback: (dto.ai_feedback ?? undefined) as Prisma.InputJsonValue,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      },
    })
    return this.toWire(row)
  }

  /** The one camelCase-row → snake_case-contract boundary (DET-278). */
  private toWire(row: PrismaArticleLearningEvent): ArticleLearningEvent {
    return {
      id: row.id,
      user_id: row.userId,
      article_id: row.articleId,
      article_version_id: row.articleVersionId ?? undefined,
      section_id: row.sectionId ?? undefined,
      block_id: row.blockId ?? undefined,
      source_span_ids: row.sourceSpanIds,
      event_type: row.eventType,
      prompt: row.prompt ?? undefined,
      user_answer: row.userAnswer ?? undefined,
      ai_feedback:
        (row.aiFeedback as ArticleLearningFeedback | null) ?? undefined,
      metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }
  }
}
