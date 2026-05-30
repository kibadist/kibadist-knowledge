import { FrictionLevel } from '@kibadist/prisma'
import { IsEnum } from 'class-validator'

export class SetFrictionDto {
  // The user's explicit escalate/de-escalate (DET-197). MINIMAL/LIGHT/DEEP/
  // RIGOROUS — decides which proof-of-learning gates are required. This is the
  // ONLY way the stored level changes, so the system never silently downgrades.
  @IsEnum(FrictionLevel)
  level!: FrictionLevel
}
