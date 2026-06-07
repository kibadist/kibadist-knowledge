import { IsBoolean, IsIn, IsOptional } from 'class-validator'

import { ONBOARDING_STEP_KEYS } from '../onboarding.steps'

/**
 * PATCH body for the first-run walkthrough (DET-307). Both fields are optional: a
 * client may dismiss the checklist forever, mark a data-trail-less step (the Map
 * view) as done, or both. `completedStep` is constrained to the known step keys.
 */
export class UpdateOnboardingDto {
  @IsOptional()
  @IsBoolean()
  dismissed?: boolean

  @IsOptional()
  @IsIn(ONBOARDING_STEP_KEYS as unknown as string[])
  completedStep?: string
}
