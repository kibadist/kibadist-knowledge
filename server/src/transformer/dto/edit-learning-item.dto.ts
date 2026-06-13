import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

/**
 * PATCH body for editing a learning item's content (DET-359). Content-only — it
 * never carries a validation status, so editing can't internalize a concept.
 * Every field is optional; the service rejects an all-empty body. `importance`
 * applies to concept candidates only.
 */
export class EditLearningItemDto {
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
