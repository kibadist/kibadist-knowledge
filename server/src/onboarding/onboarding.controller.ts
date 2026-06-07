import { Body, Controller, Get, Patch, Post } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { UpdateOnboardingDto } from './dto/update-onboarding.dto'
import { OnboardingService } from './onboarding.service'

/**
 * First-run onboarding (DET-307). The Today checklist reads `GET /onboarding`,
 * seeds the built-in starter with `POST /onboarding/starter`, and dismisses or
 * marks Map-viewed via `PATCH /onboarding`. Workspace scoping mirrors the inbox:
 * the requested workspace is resolved + ownership-checked before any read or seed.
 */
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  async status(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.onboarding.getStatus(user.userId, workspaceId)
  }

  @Post('starter')
  async seedStarter(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.onboarding.seedStarter(user.userId, workspaceId)
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOnboardingDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.onboarding.update(user.userId, workspaceId, dto)
  }
}
