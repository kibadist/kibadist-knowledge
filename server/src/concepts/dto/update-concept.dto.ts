import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

// NOTE: no `status` field by design — status transitions are owned solely by the
// Proof-of-Learning Gate (DET-189), never by a generic PATCH. See CreateConceptDto.
export class UpdateConceptDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string
}
