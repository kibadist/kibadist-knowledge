import '@fastify/multipart'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { FastifyReply, FastifyRequest } from 'fastify'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { MAX_PDF_BYTES } from '../inbox/inbox.constants'
import { AI_THROTTLE } from '../throttler/ai-throttle.constant'
import { WorkspaceId } from '../workspaces/workspace-id.decorator'
import { WorkspacesService } from '../workspaces/workspaces.service'
import { CreateTextSourceDto } from './dto/create-text-source.dto'
import { CreateUrlSourceDto } from './dto/create-url-source.dto'
import { RenderIllustrationDto } from './dto/render-illustration.dto'
import { UpdateIllustrationDto } from './dto/update-illustration.dto'
import { UpdateLearningItemDto } from './dto/update-learning-item.dto'
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

  @Throttle(AI_THROTTLE)
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

  @Throttle(AI_THROTTLE)
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

  @Throttle(AI_THROTTLE)
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

  @Throttle(AI_THROTTLE)
  @Post('sources/:id/transform')
  transform(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transformer.transform(user.userId, id)
  }

  @Get('articles/:id')
  getArticle(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transformer.getArticle(user.userId, id)
  }

  /**
   * Blocks at the article's PINNED blocksVersion (DET-249/257): the inspector
   * must resolve sourceBlockIds against the version the article was generated
   * from, not the source's current version (which a re-extraction may bump).
   */
  @Get('articles/:id/blocks')
  articleBlocks(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transformer.articleBlocks(user.userId, id)
  }

  @Throttle(AI_THROTTLE)
  @Post('articles/:id/illustrations')
  generateIllustrations(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.transformer.generateIllustrations(user.userId, id)
  }

  @Patch('articles/:id/illustrations/:suggestionId')
  updateIllustration(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: UpdateIllustrationDto,
  ) {
    return this.transformer.updateIllustrationApproval(
      user.userId,
      id,
      suggestionId,
      dto.approval,
    )
  }

  /**
   * Render an APPROVED illustration suggestion into a real image (DET-261).
   * AI-throttled. Every guard (ownership, approval, high-risk confirmation) is
   * enforced in the service; the client is never trusted.
   */
  @Throttle(AI_THROTTLE)
  @Post('articles/:id/illustrations/:suggestionId/render')
  renderIllustration(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: RenderIllustrationDto,
  ) {
    return this.transformer.renderIllustration(
      user.userId,
      id,
      suggestionId,
      dto.confirmHighRisk ?? false,
    )
  }

  /**
   * Stream a rendered illustration's stored bytes (DET-261). Ownership-scoped,
   * NOT AI-throttled (it's a read). The frontend fetches this with its bearer
   * token and turns the bytes into an object URL (an `<img src>` can't send
   * Authorization). 404 if the suggestion was never rendered.
   */
  @Get('articles/:id/illustrations/:suggestionId/image')
  async getIllustrationImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Res() reply: FastifyReply,
  ) {
    const image = await this.transformer.getIllustrationImage(
      user.userId,
      id,
      suggestionId,
    )
    // Raw bytes; @Res() takes over the response so Fastify sends the Buffer
    // as-is (no JSON serialization). The stored bytes are always PNG, so pin the
    // content-type to a constant and forbid MIME-sniffing — defence against a
    // future provider ever returning a sniffable type.
    await reply
      .header('X-Content-Type-Options', 'nosniff')
      .type('image/png')
      .send(image.data)
  }

  /** Remove a rendered illustration (DET-261); clears suggestion.image. */
  @Delete('articles/:id/illustrations/:suggestionId/image')
  deleteIllustrationImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    return this.transformer.deleteIllustrationImage(
      user.userId,
      id,
      suggestionId,
    )
  }

  @Throttle(AI_THROTTLE)
  @Post('articles/:id/learning-layer')
  generateLearningLayer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.transformer.generateLearningLayer(user.userId, id)
  }

  /**
   * Extract concept CANDIDATES for one section of an article (DET-283).
   * AI-throttled like generateLearningLayer. Candidates are proposals — never
   * library Concept rows; the service enforces grounding + the replace-pending
   * rule in code. Workspace/user scoping is identical to the other article
   * endpoints (ownership resolved via the source's userId in the service).
   */
  @Throttle(AI_THROTTLE)
  @Post('articles/:id/sections/:sectionId/concepts')
  extractSectionConcepts(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
  ) {
    return this.transformer.extractSectionConcepts(user.userId, id, sectionId)
  }

  @Patch('articles/:id/learning-layer/items/:itemId')
  updateLearningItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateLearningItemDto,
  ) {
    return this.transformer.updateLearningItem(
      user.userId,
      id,
      itemId,
      dto.validationStatus,
    )
  }
}
