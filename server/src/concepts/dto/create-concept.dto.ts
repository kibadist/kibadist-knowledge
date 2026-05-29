import { ConceptStatus } from '@kibadist/prisma'
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

export class CreateConceptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  sourceText?: string

  @IsOptional()
  @IsEnum(ConceptStatus)
  status?: ConceptStatus
}
