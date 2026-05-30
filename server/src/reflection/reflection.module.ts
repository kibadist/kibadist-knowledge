import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { ConnectorModule } from '../connector/connector.module'
import { ReflectionController } from './reflection.controller'
import { ReflectionService } from './reflection.service'

/**
 * Reflection (DET-196). The closing step of an Understanding Session: each
 * recorded reflection drives a concrete downstream effect via the cognitive
 * state machine, the Connector, or a scheduling/flag nudge. Exports
 * {@link ReflectionService} so other surfaces (e.g. the concept view) can read
 * a concept's reflection history. (PrismaModule is @Global.)
 */
@Module({
  imports: [ConceptStateModule, ConnectorModule, ConceptsModule],
  controllers: [ReflectionController],
  providers: [ReflectionService],
  exports: [ReflectionService],
})
export class ReflectionModule {}
