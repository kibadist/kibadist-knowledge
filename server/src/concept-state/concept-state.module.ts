import { Module } from '@nestjs/common'

import { ConceptStateService } from './concept-state.service'

/**
 * The cognitive state machine (DET-194). Exports {@link ConceptStateService} so
 * the capture, intake, promotion, session, decay, and connector flows can move a
 * concept through its lifecycle and read its transition history.
 * (PrismaModule is @Global, so it need not be imported here.)
 */
@Module({
  providers: [ConceptStateService],
  exports: [ConceptStateService],
})
export class ConceptStateModule {}
