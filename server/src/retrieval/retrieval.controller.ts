import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { CreateRetrievalEventDto } from './dto/create-retrieval-event.dto'
import { CreateReviewPromptDto } from './dto/create-review-prompt.dto'
import { GradeRetrievalDto } from './dto/grade-retrieval.dto'
import { RetrievalService } from './retrieval.service'
import { ReviewPromptService } from './review-prompt.service'

@Controller('retrieval-events')
export class RetrievalController {
  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly reviewPrompts: ReviewPromptService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('conceptId') conceptId?: string) {
    return this.retrievalService.findAllForUser(user.userId, conceptId)
  }

  // Approved review prompts (DET-301): the downstream sink for DET-288 Spaced
  // Review. Declared with the rest of the literal routes (before ':param' routes)
  // so 'prompts' is matched literally. The Retrieval Engine owns this store.
  @Get('prompts')
  listPrompts(
    @CurrentUser() user: AuthUser,
    @Query('articleId') articleId?: string,
  ) {
    return this.reviewPrompts.listForUser(user.userId, articleId)
  }

  @Post('prompts')
  approvePrompt(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReviewPromptDto,
  ) {
    return this.reviewPrompts.approve(user.userId, dto)
  }

  // Concepts due for resurfacing (DET-192). Declared before the ':param' routes
  // below so 'due' / 'cards' / 'grade' are matched literally, not as ids.
  @Get('due')
  due(@CurrentUser() user: AuthUser) {
    return this.retrievalService.due(user.userId)
  }

  // Retrieval cards for one concept — generated from the user's compression, not
  // the source (DET-192).
  @Get('cards/:conceptId')
  cards(@CurrentUser() user: AuthUser, @Param('conceptId') conceptId: string) {
    return this.retrievalService.cardsFor(user.userId, conceptId)
  }

  @Post('grade')
  grade(@CurrentUser() user: AuthUser, @Body() dto: GradeRetrievalDto) {
    return this.retrievalService.grade(user.userId, dto.conceptId, dto)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRetrievalEventDto) {
    return this.retrievalService.create(user.userId, dto)
  }
}
