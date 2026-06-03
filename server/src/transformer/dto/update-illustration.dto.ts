import { IsIn } from 'class-validator'

/** PATCH body for an illustration suggestion's approval gate (DET-259). */
export class UpdateIllustrationDto {
  @IsIn(['pending', 'approved', 'rejected'])
  approval!: 'pending' | 'approved' | 'rejected'
}
