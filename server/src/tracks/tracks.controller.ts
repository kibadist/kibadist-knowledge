import { type TrackStatus } from '@kibadist/prisma'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { CreateTrackDto } from './dto/create-track.dto'
import { UpdateTrackDto } from './dto/update-track.dto'
import { TracksService } from './tracks.service'

// Tracks (DET-235): the goal-directed layer, the product's primary entry point.
// List/create are scoped to the active workspace (resolved from `X-Workspace-Id`/
// `?workspaceId`, validated against the user); update/delete are scoped by track
// id with an ownership check that joins through the workspace owner.
@Controller('tracks')
export class TracksController {
  constructor(
    private readonly tracks: TracksService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: TrackStatus,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.tracks.findAllForWorkspace(workspaceId, status)
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTrackDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.tracks.create(workspaceId, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTrackDto,
  ) {
    return this.tracks.update(user.userId, id, dto)
  }

  // Deleting a track drops its TrackConcept rows (cascade) but never the concepts.
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.tracks.remove(user.userId, id)
  }
}
