import { Module } from '@nestjs/common'

import { WorkspacesModule } from '../workspaces/workspaces.module'
import { GraphController } from './graph.controller'
import { GraphService } from './graph.service'
import { GraphViewsController } from './graph-views.controller'
import { GraphViewsService } from './graph-views.service'

/**
 * The Concept Graph / Overview Map (DET-230) + scoped views (DET-236). Ownership
 * of saved positions is checked with a single batched count query against the
 * (@Global) PrismaService; node activation uses the pure `currentActivation` fn
 * imported directly from the decay module. GraphViewsService depends on
 * GraphService to resolve a saved view's stored scope to a live graph.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [GraphController, GraphViewsController],
  providers: [GraphService, GraphViewsService],
})
export class GraphModule {}
