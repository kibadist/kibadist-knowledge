import { Certainty } from '@kibadist/prisma'
import { IsEnum } from 'class-validator'

// The user's epistemic stance on a concept (DET-199). Uncertainty is expressible
// rather than flattened — ASSERTED/TENTATIVE/UNCERTAIN, owned by the user.
export class CertaintyDto {
  @IsEnum(Certainty)
  certainty!: Certainty
}
