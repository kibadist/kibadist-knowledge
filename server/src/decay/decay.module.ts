import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { DecayService } from './decay.service'

/**
 * Memory decay (DET-195). Exports {@link DecayService} so the event paths that
 * keep a concept alive (retrieval, links, Tutor), the session loop (the lazy
 * sweep), and the concept layer (revive) can refresh/sweep/revive activation.
 *
 * Imports ConceptStateModule to drive `* → DORMANT` / `DORMANT → RETRIEVED`
 * moves. Deliberately does NOT import ConceptsModule (it does its own ownership
 * checks) so ConceptsModule can import THIS module without a cycle.
 * (PrismaModule is @Global, so it need not be imported here.)
 */
@Module({
  imports: [ConceptStateModule],
  providers: [DecayService],
  exports: [DecayService],
})
export class DecayModule {}
