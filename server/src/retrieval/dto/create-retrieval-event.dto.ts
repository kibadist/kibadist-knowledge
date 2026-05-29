import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class CreateRetrievalEventDto {
  @IsString()
  @IsNotEmpty()
  conceptId!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  question?: string

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  response?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  score?: number
}
