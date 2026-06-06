import { Module } from '@nestjs/common'

import { ConceptStateModule } from '../concept-state/concept-state.module'
import { TransformerModule } from '../transformer/transformer.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { InboxController } from './inbox.controller'
import { InboxService } from './inbox.service'

@Module({
  // Unified capture (DET-300): TransformerModule exports TransformerService, which
  // InboxService uses to ingest a companion source on every capture. No cycle —
  // TransformerModule never imports InboxModule (only its MAX_PDF_BYTES constant).
  imports: [ConceptStateModule, WorkspacesModule, TransformerModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
