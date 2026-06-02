import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { InboxController } from './inbox.controller'
import { InboxService } from './inbox.service'

@Module({
  imports: [ConceptStateModule, WorkspacesModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
