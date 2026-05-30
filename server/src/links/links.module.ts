import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { LinksController } from './links.controller'
import { LinksService } from './links.service'

@Module({
  imports: [ConceptsModule, ConceptStateModule],
  controllers: [LinksController],
  providers: [LinksService],
})
export class LinksModule {}
