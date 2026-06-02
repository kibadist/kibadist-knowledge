import { GraphScope } from '@kibadist/prisma'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { SavePositionsDto } from './dto/save-positions.dto'
import { GraphService } from './graph.service'

// The Concept Graph / Overview Map (DET-230) + the scoped resolver (DET-236). The
// earned layer derived live from concepts + links, plus the user's hand-placed
// node positions. `GET /graph` with no params is the WORKSPACE scope (unchanged
// for existing clients); scope params narrow it to a track/domain/article/
// neighborhood slice over the SAME live data.
@Controller('graph')
export class GraphController {
  constructor(
    private readonly graphService: GraphService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async getGraph(
    @CurrentUser() user: AuthUser,
    @Query('scope') scope?: string,
    @Query('trackId') trackId?: string,
    @Query('domainId') domainId?: string,
    @Query('sourceConceptId') sourceConceptId?: string,
    @Query('centerConceptId') centerConceptId?: string,
    @Query('hops') hops?: string,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.graphService.getScopedGraph(user.userId, workspaceId, {
      scope: parseScope(scope),
      trackId,
      domainId,
      sourceConceptId,
      centerConceptId,
      hops: parseHops(hops),
    })
  }

  // Persist the user's manual node placements. Layout re-runs never destroy these.
  @Put('positions')
  savePositions(@CurrentUser() user: AuthUser, @Body() dto: SavePositionsDto) {
    return this.graphService.savePositions(user.userId, dto)
  }
}

/** Validate the `scope` query param, defaulting to WORKSPACE when omitted. */
function parseScope(scope?: string): GraphScope {
  if (!scope) return GraphScope.WORKSPACE
  if (!(scope in GraphScope)) {
    throw new BadRequestException(`Unknown graph scope "${scope}"`)
  }
  return scope as GraphScope
}

/** Parse the optional `hops` query param (1–2, validated in the resolver). */
function parseHops(hops?: string): number | undefined {
  if (hops === undefined) return undefined
  const parsed = Number(hops)
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException('hops must be an integer')
  }
  return parsed
}
