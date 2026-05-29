import { LinkStatus } from '@kibadist/prisma'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateLinkDto {
  @IsOptional()
  @IsEnum(LinkStatus)
  status?: LinkStatus

  @IsOptional()
  @IsString()
  @MaxLength(100)
  relation?: string
}
