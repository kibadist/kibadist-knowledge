import { IsInt, IsOptional, Max, Min } from 'class-validator'

/**
 * Start (or resume) an Understanding Session (DET-198). `targetMinutes` is the
 * user's desired length; the concept-count is derived from it by the pure
 * session policy, clamped to a 5–15 concept window.
 */
export class StartSessionDto {
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  targetMinutes?: number
}
