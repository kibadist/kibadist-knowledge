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
import { CreateWorkspaceDto } from './dto/create-workspace.dto'
import { UpdateWorkspaceDto } from './dto/update-workspace.dto'
import { WorkspacesService } from './workspaces.service'

// Workspaces (DET-232): the tenancy container that owns a user's concepts. All
// routes are scoped to the authenticated user; there is no cross-user access.
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.findAllForUser(user.userId)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user.userId, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(user.userId, id, dto)
  }

  // Deleting a workspace cascades to its concepts; the service blocks deleting a
  // user's only workspace so an account always has somewhere to capture.
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.workspaces.remove(user.userId, id)
  }
}
