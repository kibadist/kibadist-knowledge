import { IsIn } from 'class-validator'

/** PATCH body for a learning-layer concept's validation flow (DET-258). */
export class UpdateLearningItemDto {
  @IsIn(['pending', 'validated', 'dismissed'])
  validationStatus!: 'pending' | 'validated' | 'dismissed'
}
