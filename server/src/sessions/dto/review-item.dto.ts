import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator'

/**
 * Review one concept in a session (DET-198). `score` is the 0–5 self-rated
 * recall quality; it is delegated to the Retrieval Engine (DET-192) which
 * records the event, reschedules, and advances cognitive state.
 */
export class ReviewItemDto {
  @IsString()
  @IsNotEmpty()
  conceptId!: string

  @IsInt()
  @Min(0)
  @Max(5)
  score!: number
}
