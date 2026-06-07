import { RequiredDepth, TrackStatus, TrackType } from '@kibadist/prisma'
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

// Partial update of a Track (DET-235): rename, re-describe, re-goal, change type,
// and drive the status lifecycle (active → paused → completed → archived). Every
// field is optional.
export class UpdateTrackDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsOptional()
  @IsEnum(TrackType)
  type?: TrackType

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  goal?: string

  // The track's default demanded depth (DET-311). Changing it only affects how
  // future promotions into this track propose friction — never earned concepts.
  @IsOptional()
  @IsEnum(RequiredDepth)
  requiredDepth?: RequiredDepth

  @IsOptional()
  @IsEnum(TrackStatus)
  status?: TrackStatus
}
