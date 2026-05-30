import { IsIn, IsOptional } from 'class-validator'

import { TUTOR_ANGLES, type TutorAngle } from '../tutor.prompt'

export class ChallengeTutorDto {
  // The challenge angle to take. Omitted → the service rotates deterministically.
  @IsOptional()
  @IsIn(TUTOR_ANGLES)
  angle?: TutorAngle
}
