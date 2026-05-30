import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { DecayModule } from '../decay/decay.module'
import { LinksController } from './links.controller'
import { LinksService } from './links.service'

@Module({
  imports: [ConceptsModule, ConceptStateModule, DecayModule],
  controllers: [LinksController],
  providers: [LinksService],
})
export class LinksModule {}
