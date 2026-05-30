import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsController } from './concepts.controller'
import { ConceptsService } from './concepts.service'

@Module({
  imports: [ConceptStateModule],
  controllers: [ConceptsController],
  providers: [ConceptsService],
  exports: [ConceptsService],
})
export class ConceptsModule {}
