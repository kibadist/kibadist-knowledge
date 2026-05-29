import { IsString, MaxLength, MinLength } from 'class-validator'

export class AnswerRetrievalDto {
  // The user's from-memory recall in response to the generated retrieval prompt.
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  response!: string
}
