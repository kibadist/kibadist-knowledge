import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Persist one approved review prompt into the Retrieval Engine (DET-301 wires
 * DET-288 Spaced Review to real articles). The wire shape is the snake_case
 * `ScheduledReviewPrompt` contract authored in
 * `web/src/components/deep-reading/spaced-review-mode.tsx` (extends the DET-288
 * `ReviewPrompt`). The client only ever hands over APPROVED prompts; `user_id`
 * and the schedule are server-owned (the engine assigns the cadence), so neither
 * is read from the body. Keep these field names verbatim — they are a
 * cross-system contract, not internal camelCase. `schedule_metadata` and
 * `section_heading` ride along on the wire for the client's own use and are
 * intentionally not persisted here.
 */
export class CreateReviewPromptDto {
  // Deterministic id (rp_<scope>_<type>_<slug>); the upsert key per user.
  @IsString()
  prompt_id!: string

  @IsString()
  article_id!: string

  @IsOptional()
  @IsString()
  article_version_id?: string

  @IsOptional()
  @IsString()
  section_id?: string

  // Soft reference — may be an inbox/un-promoted concept, a real one, or absent.
  @IsOptional()
  @IsString()
  concept_id?: string

  @IsString()
  prompt_type!: string

  @IsString()
  origin!: string

  @IsString()
  @MaxLength(2000)
  subject!: string

  @IsString()
  @MaxLength(4000)
  question!: string

  @IsString()
  @MaxLength(8000)
  expected_answer_summary!: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  source_span_ids?: string[]

  @IsOptional()
  @IsString()
  created_from_event_id?: string
}
