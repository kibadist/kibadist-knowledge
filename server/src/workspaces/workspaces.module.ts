import { Module } from '@nestjs/common'

import { WorkspacesController } from './workspaces.controller'
import { WorkspacesService } from './workspaces.service'

/**
 * Workspaces (DET-232): tenancy for the knowledge graph. Exports
 * WorkspacesService so other modules (auth provisioning, and the concept/inbox/
 * graph/session paths that resolve the active workspace) can use it. Depends only
 * on the @Global PrismaService, so no imports are needed.
 */
@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
