import { Body, Controller, Get, Post, Query } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { ArticleLearningEventsService } from './article-learning-events.service'
import { CreateArticleLearningEventDto } from './dto/create-article-learning-event.dto'

/**
 * Read/append the `article_learning_events` log (DET-301). Deep Reading Mode on a
 * real transformed article hydrates from `GET /article-learning/events` on load
 * and appends through `POST /article-learning/events` as the learner predicts,
 * rewrites, compares, extracts, or schedules review — so completion markers
 * persist across reloads. Every route is user-scoped via the JWT.
 */
@Controller('article-learning')
export class ArticleLearningController {
  constructor(private readonly events: ArticleLearningEventsService) {}

  @Get('events')
  list(@CurrentUser() user: AuthUser, @Query('articleId') articleId: string) {
    return this.events.listForUser(user.userId, articleId)
  }

  @Post('events')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateArticleLearningEventDto,
  ) {
    return this.events.create(user.userId, dto)
  }
}
