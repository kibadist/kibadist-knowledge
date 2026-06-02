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
 * paid completion). PrismaModule is @Global. Exports DomainsService in case a
 * later organizational layer (Tracks/GraphViews) needs membership reads.
 */
@Module({
  imports: [WorkspacesModule, ConceptsModule, AiModule],
  controllers: [DomainsController, ConceptDomainsController],
  providers: [DomainsService, DomainSuggestionService],
  exports: [DomainsService],
})
export class DomainsModule {}
