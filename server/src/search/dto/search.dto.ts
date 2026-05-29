import { Type } from 'class-transformer'
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export class SearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  query!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number
}
