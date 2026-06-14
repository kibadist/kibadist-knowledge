import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

/**
 * PATCH body for a retrieval prompt's review flow (DET-359). The allowed
 * statuses deliberately EXCLUDE any "scheduled" state — this endpoint can never
 * turn a prompt into a permanent review card; scheduling stays a downstream,
 * explicitly-gated step. The service additionally requires an answer to mark a
 * prompt `answered`. Every field is optional; an all-empty body is rejected.
 */
export class UpdateRetrievalPromptDto {
  @IsOptional()
  @IsIn(['suggested', 'saved', 'answered', 'rejected'])
  reviewStatus?: 'suggested' | 'saved' | 'answered' | 'rejected'

  @IsOptional()
  @IsString()
  userAnswer?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  prompt?: string
}
