import { RequiredDepth, TrackType } from '@kibadist/prisma'
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'

// A Track (DET-235) is the goal-directed layer. The owning workspace is resolved
// from the request (header/query), never the client body; status starts ACTIVE.
export class CreateTrackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string

  @IsEnum(TrackType)
  type!: TrackType

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  goal?: string

  // How deeply this track wants its concepts understood by default (DET-311).
  // Pulls a concept's earning friction up at promotion; defaults to EXPLAIN.
  @IsOptional()
  @IsEnum(RequiredDepth)
  requiredDepth?: RequiredDepth
}
