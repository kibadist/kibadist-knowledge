import { IsNotEmpty, IsString } from 'class-validator'

/** Dismiss a proposed connection between two concepts (DET-191). */
export class RejectLinkDto {
  @IsString()
  @IsNotEmpty()
  sourceConceptId!: string

  @IsString()
  @IsNotEmpty()
  targetConceptId!: string
}
