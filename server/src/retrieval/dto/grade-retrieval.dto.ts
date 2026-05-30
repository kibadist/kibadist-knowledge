import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

/**
 * Grade one spaced retrieval attempt (DET-192). `score` is the required 0–5
 * SM-2 recall quality; the rest is the card context the user answered against,
 * recorded on the RetrievalEvent.
 */
export class GradeRetrievalDto {
  @IsString()
  @IsNotEmpty()
  conceptId!: string

  @IsInt()
  @Min(0)
  @Max(5)
  score!: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  question?: string

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  response?: string
}
