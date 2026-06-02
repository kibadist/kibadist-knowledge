import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptStateModule } from '../concept-state/concept-state.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { ConnectorModule } from '../connector/connector.module'
import { DomainsModule } from '../domains/domains.module'
import { SearchModule } from '../search/search.module'
import { SourceQaModule } from '../source-qa/source-qa.module'
import { TracksModule } from '../tracks/tracks.module'
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
    // Track-first onboarding (DET-240): after a successful commit, enroll the
    // earned concept into its target track + suggest domains, both best-effort.
    TracksModule,
    DomainsModule,
  ],
  controllers: [PromotionController],
  providers: [PromotionService],
})
export class PromotionModule {}
