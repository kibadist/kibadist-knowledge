import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class AskQuestionDto {
  // The user's own question about the source they're reading. Capped to match
  // the prompt's MAX_QUESTION_CHARS budget.
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  questionText!: string

  // Concept Library scoping (DET-211): when present, ground the answer in this
  // chunk's source blocks instead of the whole document. Default (absent) keeps
  // the whole-document behavior.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  chunkId?: string

  // Concept Library scoping (DET-211): when present, ground the answer in this
  // candidate's source blocks. `chunkId` takes precedence if both are given.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  candidateId?: string
}
