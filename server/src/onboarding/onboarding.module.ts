import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { OnboardingController } from './onboarding.controller'
import { OnboardingService } from './onboarding.service'

/**
 * First-run onboarding (DET-307): seeds the built-in starter article and reports
 * the guided checklist. Imports ConceptStateModule (to write the companion inbox
 * concept's capture transition) and WorkspacesModule (to resolve the active
 * workspace). PrismaModule is @Global, so it needs no explicit import.
 */
@Module({
  imports: [ConceptStateModule, WorkspacesModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
