import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'

/**
 * Review one item in a session (DET-198, unified in DET-310). `score` is the 0–5
 * self-rated recall quality. The item is EITHER a concept (`conceptId`, delegated
 * to the Retrieval Engine which records the event, reschedules, and advances
 * cognitive state) OR an approved Spaced Review prompt (`reviewPromptId`,
 * rescheduled on the prompt store). Exactly one identifier is required:
 * `conceptId` is validated only when `reviewPromptId` is absent.
 */
export class ReviewItemDto {
  // An approved-review-prompt item (DET-310). When present, this is a prompt
  // review; otherwise `conceptId` identifies a concept item.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reviewPromptId?: string

  @ValidateIf((dto: ReviewItemDto) => !dto.reviewPromptId)
  @IsString()
  @IsNotEmpty()
  conceptId?: string

  @IsInt()
  @Min(0)
  @Max(5)
  score!: number
}
