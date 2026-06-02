import '@fastify/multipart'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { CaptureTextDto } from './dto/capture-text.dto'
import { CaptureUrlDto } from './dto/capture-url.dto'
import { MAX_PDF_BYTES } from './inbox.constants'
import { InboxService } from './inbox.service'

@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
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
    return this.inbox.list(user.userId, workspaceId)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.findOne(user.userId, id)
  }

  // The Concept Library (DET-211): the item's structured article split into
  // section-sized learnable chunks. Kept on the inbox item — chunking acts on a
  // captured source before it's earned.
  @Get(':id/chunks')
  chunks(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.chunks(user.userId, id)
  }

  @Post('text')
  async captureText(
    @CurrentUser() user: AuthUser,
    @Body() dto: CaptureTextDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.inbox.captureText(user.userId, workspaceId, dto)
  }

  @Post('url')
  async captureUrl(
    @CurrentUser() user: AuthUser,
    @Body() dto: CaptureUrlDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.inbox.captureUrl(user.userId, workspaceId, dto)
  }

  @Post('pdf')
  async capturePdf(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    const data = await req.file({ limits: { fileSize: MAX_PDF_BYTES } })
    if (!data) throw new BadRequestException('No file uploaded')
    if (data.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are accepted')
    }
    const buffer = await data.toBuffer()
    // @fastify/multipart sets `truncated` when the stream hit the size limit.
    if (data.file.truncated) {
      throw new BadRequestException('PDF exceeds the 10MB limit')
    }
    return this.inbox.capturePdf(
      user.userId,
      workspaceId,
      data.filename,
      buffer,
    )
  }

  @Delete(':id')
  @HttpCode(204)
  async discard(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.inbox.discard(user.userId, id)
  }
}
