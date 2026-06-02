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
import { DomainsService } from './domains.service'
import { CreateDomainDto } from './dto/create-domain.dto'
import { UpdateDomainDto } from './dto/update-domain.dto'

// Domains (DET-234): semantic regions of a workspace. List/create are scoped to
// the active workspace (resolved from `X-Workspace-Id`/`?workspaceId`, validated
// against the user); update/delete are scoped by domain id with an ownership
// check that joins through the workspace owner.
@Controller('domains')
export class DomainsController {
  constructor(
    private readonly domains: DomainsService,
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
    return this.domains.findAllForWorkspace(workspaceId)
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDomainDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.domains.create(user.userId, workspaceId, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDomainDto,
  ) {
    return this.domains.update(user.userId, id, dto)
  }

  // Deleting a domain orphans its ConceptDomain rows (cascade) but never the
  // concepts — a domain is a region, not a container.
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.domains.remove(user.userId, id)
  }
}
