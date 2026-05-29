import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { SearchModule } from '../search/search.module'
import { PromotionController } from './promotion.controller'
import { PromotionService } from './promotion.service'

@Module({
  imports: [ConceptsModule, AiModule, SearchModule],
  controllers: [PromotionController],
  providers: [PromotionService],
})
export class PromotionModule {}
