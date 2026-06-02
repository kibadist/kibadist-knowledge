import { Body, Controller, Get, Param, Post } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { ReviewItemDto } from './dto/review-item.dto'
import { StartSessionDto } from './dto/start-session.dto'
import { SessionsService } from './sessions.service'

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Start a new session, or resume the user's existing ACTIVE one. */
  @Post()
  async start(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartSessionDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.sessions.start(user.userId, workspaceId, dto.targetMinutes)
  }

  // Static routes declared before the `:id` routes so they match literally.
  /** The user's ACTIVE session, or null — used to resume. */
  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.sessions.getActive(user.userId)
  }

  /** Recent sessions for a simple history view. */
  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.sessions.history(user.userId)
  }

  /** Review one concept in the session — delegates grading to the Retrieval
   *  Engine and marks the item reviewed. */
  @Post(':id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewItemDto,
  ) {
    return this.sessions.reviewItem(user.userId, id, dto.conceptId, dto.score)
  }

  /** End the session (mark COMPLETED). */
  @Post(':id/end')
  end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.end(user.userId, id)
  }
}
