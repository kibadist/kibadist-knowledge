import { GraphScope } from '@kibadist/prisma'
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

// Partial update of a saved graph view (DET-236). Every field optional; the
// service re-validates that the resulting scope still has its required target.
export class UpdateGraphViewDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string

  @IsOptional()
  @IsEnum(GraphScope)
  scope?: GraphScope

  @IsOptional()
  @IsString()
  sourceConceptId?: string

  @IsOptional()
  @IsString()
  trackId?: string

  @IsOptional()
  @IsString()
  domainId?: string

  @IsOptional()
  @IsString()
  centerConceptId?: string

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>

  @IsOptional()
  @IsObject()
  layout?: Record<string, unknown>
}
