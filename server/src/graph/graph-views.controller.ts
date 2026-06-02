import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { CreateGraphViewDto } from './dto/create-graph-view.dto'
import { UpdateGraphViewDto } from './dto/update-graph-view.dto'
import { GraphViewsService } from './graph-views.service'

// Saved, scoped graph views (DET-236). List/create are scoped to the active
// workspace; update/delete/resolve are scoped by view id with an ownership check
// that joins through the workspace owner. Resolving a view recomputes its graph
// live — a view is a query, never a stored subgraph.
@Controller('graph-views')
export class GraphViewsController {
  constructor(
    private readonly views: GraphViewsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.views.findAllForWorkspace(workspaceId)
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateGraphViewDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.views.create(workspaceId, dto)
  }

  // The live graph for a saved view — resolved fresh from Concept/Link each call.
  @Get(':id/resolve')
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.views.resolve(user.userId, id)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateGraphViewDto,
  ) {
    return this.views.update(user.userId, id, dto)
  }

  // Deleting a view never deletes concepts/links/positions.
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.views.remove(user.userId, id)
  }
}
