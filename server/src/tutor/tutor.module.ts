import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { SearchModule } from '../search/search.module'
import { TutorController } from './tutor.controller'
import { TutorService } from './tutor.service'

@Module({
  imports: [AiModule, ConceptsModule, ConceptStateModule, SearchModule],
  controllers: [TutorController],
  providers: [TutorService],
})
export class TutorModule {}
