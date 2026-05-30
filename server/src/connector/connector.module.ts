import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { SearchModule } from '../search/search.module'
import { ConnectorService } from './connector.service'

/**
 * The Connector (DET-191). Exports {@link ConnectorService} so promotion can
 * surface typed ephemeral proposals during the gate and kick off the persisted
 * background pass after a concept becomes PERMANENT. (PrismaModule is @Global.)
 */
@Module({
  imports: [AiModule, SearchModule, ConceptsModule, ConceptStateModule],
  providers: [ConnectorService],
  exports: [ConnectorService],
})
export class ConnectorModule {}
