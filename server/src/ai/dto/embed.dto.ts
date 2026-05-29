import { IsString, MaxLength, MinLength } from 'class-validator'

// Diagnostic endpoint takes a single string; AiService.embed also accepts
// string[] for batch embedding, which later tickets call directly.
export class EmbedDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  input!: string
}
