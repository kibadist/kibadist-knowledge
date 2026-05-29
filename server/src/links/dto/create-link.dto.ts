import { LinkStatus } from '@kibadist/prisma'
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export class CreateLinkDto {
  @IsString()
  @IsNotEmpty()
  sourceConceptId!: string

  @IsString()
  @IsNotEmpty()
  targetConceptId!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  relation?: string

  @IsOptional()
  @IsEnum(LinkStatus)
  status?: LinkStatus
}
