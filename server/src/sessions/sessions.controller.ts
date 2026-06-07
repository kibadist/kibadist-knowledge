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

  /** What a session would hold right now (DET-310): the start-screen composition
   *  — how many concepts are due/contested/rediscoverable and how many approved
   *  article prompts are due. */
  @Get('preview')
  async preview(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.sessions.preview(user.userId, workspaceId)
  }

  /** Recent sessions for a simple history view. */
  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.sessions.history(user.userId)
  }

  /** Review one item in the session — a concept (delegated to the Retrieval
   *  Engine + cognitive state) or an approved review prompt (rescheduled on the
   *  prompt store). One queue, one review endpoint (DET-310). */
  @Post(':id/review')
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewItemDto,
  ) {
    if (dto.reviewPromptId) {
      return this.sessions.reviewPromptItem(
        user.userId,
        id,
        dto.reviewPromptId,
        dto.score,
      )
    }
    // The DTO guarantees a conceptId when reviewPromptId is absent.
    return this.sessions.reviewItem(
      user.userId,
      id,
      dto.conceptId as string,
      dto.score,
    )
  }

  /** End the session (mark COMPLETED). */
  @Post(':id/end')
  end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sessions.end(user.userId, id)
  }
}
