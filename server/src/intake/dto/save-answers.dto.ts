import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

/** Generous ceiling; interrogations are 3-5 questions. */
const MAX_ANSWERS = 10

export class AnswerItemDto {
  @IsString()
  @MinLength(1)
  questionId!: string

  // The user's own-words answer. Empty answers are allowed (a question can be
  // left blank), so no MinLength; cap the size.
  @IsString()
  @MaxLength(5000)
  answer!: string
}

export class SaveAnswersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ANSWERS)
  @ValidateNested({ each: true })
  @Type(() => AnswerItemDto)
  answers!: AnswerItemDto[]
}
