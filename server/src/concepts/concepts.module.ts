import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { DecayModule } from '../decay/decay.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ConceptsController } from './concepts.controller'
import { ConceptsService } from './concepts.service'

@Module({
  imports: [ConceptStateModule, DecayModule, WorkspacesModule],
  controllers: [ConceptsController],
  providers: [ConceptsService],
  exports: [ConceptsService],
})
export class ConceptsModule {}
