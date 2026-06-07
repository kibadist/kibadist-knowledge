import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

import {
  ARTICLE_LEARNING_EVENT_TYPES,
  type ArticleLearningEventType,
} from '../article-learning.types'

/**
 * Persist one `article_learning_event` (DET-301 wires Deep Reading Mode to real
 * articles). The wire shape is the snake_case DET-278 contract authored in
 * `web/src/lib/article-learning-events.ts` — the client emits drafts (no id /
 * timestamps; `user_id` is taken from the JWT, never the body) and the server
 * stamps the rest. Keep these field names verbatim: they are a cross-system
 * contract, not internal camelCase.
 */
export class CreateArticleLearningEventDto {
  @IsString()
  article_id!: string

  @IsOptional()
  @IsString()
  article_version_id?: string

  @IsOptional()
  @IsString()
  section_id?: string

  @IsOptional()
  @IsString()
  block_id?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  source_span_ids?: string[]

  @IsIn(ARTICLE_LEARNING_EVENT_TYPES as readonly string[])
  event_type!: ArticleLearningEventType

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  prompt?: string

  // The learner's own words, stored verbatim (DET-278: never paraphrase).
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  user_answer?: string

  // Structured AI feedback (claims + provenance), never only prose.
  @IsOptional()
  @IsObject()
  ai_feedback?: Record<string, unknown>

  // Per-mode extras: peek_count, focus duration, revision history, snapshots.
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}
