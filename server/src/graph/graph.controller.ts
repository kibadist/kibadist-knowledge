import { Body, Controller, Get, Put } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { SavePositionsDto } from './dto/save-positions.dto'
import { GraphService } from './graph.service'

// The Concept Graph / Overview Map (DET-230). The earned layer derived live from
// concepts + links, plus the user's hand-placed node positions.
@Controller('graph')
export class GraphController {
  constructor(
    private readonly graphService: GraphService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async getGraph(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.graphService.getGraph(user.userId, workspaceId)
  }

  // Persist the user's manual node placements. Layout re-runs never destroy these.
  @Put('positions')
  savePositions(@CurrentUser() user: AuthUser, @Body() dto: SavePositionsDto) {
    return this.graphService.savePositions(user.userId, dto)
  }
}
