import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

/**
 * PATCH body for the v3 reader's concept-candidate review (DET-359). The status
 * set is review-only: `accepted` moves a concept to the user-review state and
 * NEVER internalizes it as knowledge (the service has no concept-row side
 * effect), so this endpoint can't be a back door to permanent knowledge. Every
 * field is optional; the service rejects an all-empty body.
 */
export class UpdateV3ConceptReviewDto {
  @IsOptional()
  @IsIn(['pending', 'accepted', 'rejected', 'deferred'])
  status?: 'pending' | 'accepted' | 'rejected' | 'deferred'

  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  definition?: string

  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  importance?: 'high' | 'medium' | 'low'
}
