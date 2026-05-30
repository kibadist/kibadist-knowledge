import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator'

export class RespondTutorDto {
  // The question the Tutor posed; echoed back so it lands on the RetrievalEvent.
  @IsString()
  @MinLength(1)
  @MaxLength(600)
  question!: string

  // The user's own-words response — canonical cognition, stored as an articulation.
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  response!: string

  // Whether the user declares they DEFENDED the idea (true) or found a gap (false).
  @IsBoolean()
  defended!: boolean
}
