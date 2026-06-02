import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { ConceptDomainsController } from './concept-domains.controller'
import { DomainSuggestionService } from './domain-suggestion.service'
import { DomainsController } from './domains.controller'
import { DomainsService } from './domains.service'

/**
 * Domains (DET-234): semantic regions of a workspace + the ConceptDomain join
 * and AI suggestion. Imports WorkspacesModule (active-workspace resolution),
 * ConceptsModule (ownership / non-inbox checks), and AiModule (the suggestion's
 * paid completion). PrismaModule is @Global. Exports DomainsService for other
 * organizational layers, and DomainSuggestionService so the track-first
 * onboarding flow (DET-240) can auto-suggest domains for a newly-earned concept.
 */
@Module({
  imports: [WorkspacesModule, ConceptsModule, AiModule],
  controllers: [DomainsController, ConceptDomainsController],
  providers: [DomainsService, DomainSuggestionService],
  exports: [DomainsService, DomainSuggestionService],
})
export class DomainsModule {}
