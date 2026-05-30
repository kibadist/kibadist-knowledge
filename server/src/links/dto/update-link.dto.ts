import { LinkRelation, LinkStatus } from '@kibadist/prisma'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateLinkDto {
  @IsOptional()
  @IsEnum(LinkStatus)
  status?: LinkStatus

  @IsOptional()
  @IsString()
  @MaxLength(100)
  relation?: string

  // The typed relationship (DET-191), e.g. when the user retypes a proposal.
  @IsOptional()
  @IsEnum(LinkRelation)
  relationKind?: LinkRelation
}
