import { Module } from '@nestjs/common'

import { WorkspacesModule } from '../workspaces/workspaces.module'
import { GraphController } from './graph.controller'
import { GraphService } from './graph.service'

/**
 * The Concept Graph / Overview Map (DET-230). Ownership of saved positions is
 * checked with a single batched count query against the (@Global) PrismaService;
 * node activation uses the pure `currentActivation` fn imported directly from the
 * decay module, so no extra module wiring is needed.
 */
@Module({
  imports: [WorkspacesModule],
  controllers: [GraphController],
  providers: [GraphService],
})
export class GraphModule {}
