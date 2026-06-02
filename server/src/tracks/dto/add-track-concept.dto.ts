import { ImportanceLevel, RequiredDepth } from '@kibadist/prisma'
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'

// Add a concept to a track (DET-235): POST /tracks/:id/concepts. A manually-added
// concept defaults to ACCEPTED (the user chose it); importance/requiredDepth/order
// are optional and fall back to the schema defaults (MEDIUM / EXPLAIN).
export class AddTrackConceptDto {
  @IsString()
  conceptId!: string

  @IsOptional()
  @IsEnum(ImportanceLevel)
  importance?: ImportanceLevel

  @IsOptional()
  @IsEnum(RequiredDepth)
  requiredDepth?: RequiredDepth

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number
}
