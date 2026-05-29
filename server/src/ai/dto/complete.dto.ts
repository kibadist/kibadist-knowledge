import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export class CompleteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  prompt!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  system?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  maxTokens?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number
}
