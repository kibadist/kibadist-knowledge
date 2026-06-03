import '@fastify/multipart'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import type { FastifyRequest } from 'fastify'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { MAX_PDF_BYTES } from '../inbox/inbox.constants'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { CreateTextSourceDto } from './dto/create-text-source.dto'
import { CreateUrlSourceDto } from './dto/create-url-source.dto'
import { TransformerService } from './transformer.service'

/**
 * Transformer ingestion + inspection endpoints (DET-247…250), mounted under
 * `/transformer` (a SEPARATE area from the inbox). Workspace + user scoping is
 * identical to the inbox: the requested workspace is resolved + ownership-checked
 * on writes, and every read is scoped to the authenticated user in the service.
 *
 * Wave B adds the transform/article/illustration/learning-layer routes; M1 ships
 * only ingestion (text/url/pdf), the source list/detail, and the blocks inspector.
 */
@Controller('transformer')
export class TransformerController {
  constructor(
    private readonly transformer: TransformerService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Post('sources/text')
  async createText(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTextSourceDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.transformer.createTextSource(user.userId, workspaceId, dto)
  }

  @Post('sources/url')
  async createUrl(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUrlSourceDto,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.transformer.createUrlSource(user.userId, workspaceId, dto)
  }

  @Post('sources/pdf')
  async createPdf(
    @CurrentUser() user: AuthUser,
    @Req() req: FastifyRequest,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    // Reuse the inbox multipart pattern + the single-sourced MAX_PDF_BYTES.
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
    return this.transformer.createPdfSource(
      user.userId,
      workspaceId,
      data.filename,
      buffer,
    )
  }

  @Get('sources')
  async list(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() requestedWorkspaceId?: string,
  ) {
    const workspaceId = await this.workspaces.resolveActiveWorkspaceId(
      user.userId,
      requestedWorkspaceId,
    )
    return this.transformer.list(user.userId, workspaceId)
  }

  @Get('sources/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transformer.findOne(user.userId, id)
  }

  @Get('sources/:id/blocks')
  blocks(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transformer.blocks(user.userId, id)
  }
}
