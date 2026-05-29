import { IsString, MaxLength, MinLength } from 'class-validator'

export class SaveArticulationDto {
  // The user's own-words explanation of the concept. This becomes the canonical
  // Articulation on commit — it is never AI-authored.
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string
}
