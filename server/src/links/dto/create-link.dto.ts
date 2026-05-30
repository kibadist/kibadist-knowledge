import { LinkRelation, LinkStatus } from '@kibadist/prisma'
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

  // The typed relationship (DET-191). A user-drawn link supplies this directly.
  @IsOptional()
  @IsEnum(LinkRelation)
  relationKind?: LinkRelation

  // One-sentence rationale, carried over when confirming a Connector proposal.
  @IsOptional()
  @IsString()
  @MaxLength(400)
  rationale?: string

  @IsOptional()
  @IsEnum(LinkStatus)
  status?: LinkStatus
}
