import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { ConnectorModule } from '../connector/connector.module'
import { SearchModule } from '../search/search.module'
import { SourceQaModule } from '../source-qa/source-qa.module'
import { PromotionController } from './promotion.controller'
import { PromotionService } from './promotion.service'

@Module({
  imports: [
    ConceptsModule,
    AiModule,
    SearchModule,
    SourceQaModule,
    ConceptStateModule,
    ConnectorModule,
  ],
  controllers: [PromotionController],
  providers: [PromotionService],
})
export class PromotionModule {}
