import { IsString, MaxLength, MinLength } from 'class-validator'

export class AskQuestionDto {
  // The user's own question about the source they're reading. Capped to match
  // the prompt's MAX_QUESTION_CHARS budget.
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  questionText!: string
}
