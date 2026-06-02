import { GraphScope } from '@kibadist/prisma'
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

// A saved, scoped graph view (DET-236). The owning workspace is resolved from the
// request, never the client body. The scope's target id (sourceConceptId/trackId/
// domainId/centerConceptId) is required for that scope — enforced in the service.
export class CreateGraphViewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string

  @IsEnum(GraphScope)
  scope!: GraphScope

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

  // Opaque view filters + view-level layout prefs (zoom, auto-layout). Stored and
  // returned verbatim; never a node snapshot (positions live in GraphNodePosition).
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>

  @IsOptional()
  @IsObject()
  layout?: Record<string, unknown>
}
