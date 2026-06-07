import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { DecayModule } from '../decay/decay.module'
import { RetrievalController } from './retrieval.controller'
import { RetrievalService } from './retrieval.service'
import { ReviewPromptService } from './review-prompt.service'

@Module({
  imports: [ConceptsModule, ConceptStateModule, DecayModule],
  controllers: [RetrievalController],
  providers: [RetrievalService, ReviewPromptService],
  exports: [RetrievalService, ReviewPromptService],
})
export class RetrievalModule {}
