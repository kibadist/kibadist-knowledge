import {
  ImportanceLevel,
  RequiredDepth,
  TrackConceptStatus,
} from '@kibadist/prisma'
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator'

// Update a concept's membership in a track (DET-235): accept/complete/skip it,
// re-weight it, change the demanded depth, or reorder it. Every field optional —
// each maps to one column on the TrackConcept join. None of this touches the
// concept's own CognitiveState; `requiredDepth` is the track's demand only.
export class UpdateTrackConceptDto {
  @IsOptional()
  @IsEnum(TrackConceptStatus)
  status?: TrackConceptStatus

  @IsOptional()
  @IsEnum(ImportanceLevel)
  importance?: ImportanceLevel

  @IsOptional()
  @IsEnum(RequiredDepth)
  requiredDepth?: RequiredDepth

  @IsOptional()
  @IsInt()
  @Min(0)
  orderIndex?: number
}
