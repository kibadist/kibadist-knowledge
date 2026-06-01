import { LivingConceptStatus } from '@kibadist/prisma'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

// Edit a persona scaffold (DET-230). All fields optional. Setting
// status=USER_VALIDATED is how the user vouches for the persona; the persona text
// is metadata and never becomes an Articulation or the concept's summary.
export class UpdateLivingConceptDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  personaName?: string

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  personaSummary?: string

  @IsOptional()
  @IsString()
  @MaxLength(600)
  voice?: string

  @IsOptional()
  @IsString()
  @MaxLength(600)
  coreMetaphor?: string

  @IsOptional()
  @IsString()
  @MaxLength(600)
  metaphorBreaks?: string

  @IsOptional()
  @IsEnum(LivingConceptStatus)
  status?: LivingConceptStatus
}
