import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AnswerRetrievalDto } from './dto/answer-retrieval.dto'
import { CommitPromotionDto } from './dto/commit-promotion.dto'
import { SaveArticulationDto } from './dto/save-articulation.dto'
import { SetFrictionDto } from './dto/set-friction.dto'
import { PromotionService } from './promotion.service'

/**
 * The Proof-of-Learning Gate (DET-189). Every route is scoped to an INBOX
 * concept the caller owns; the service enforces the four gates and is the sole
 * path to a PERMANENT concept.
 */
@Controller('promotion')
export class PromotionController {
  constructor(private readonly promotion: PromotionService) {}

  /** Open the promotion flow — draft + gate checklist + suggested mode. */
  @Get(':conceptId')
  getState(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.promotion.getState(user.userId, conceptId)
  }

  /** Gate 1 — articulate in your own words. */
  @Put(':conceptId/articulation')
  saveArticulation(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: SaveArticulationDto,
  ) {
    return this.promotion.saveArticulation(user.userId, conceptId, dto.body)
  }

  /** Adaptive Friction (DET-197) — the user's explicit escalate/de-escalate. */
  @Put(':conceptId/friction')
  setFriction(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: SetFrictionDto,
  ) {
    return this.promotion.setFriction(user.userId, conceptId, dto.level)
  }

  /** Gate 2/4 — AI-proposed connections to approve or reject. */
  @Get(':conceptId/connections')
  suggestConnections(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.promotion.suggestConnections(user.userId, conceptId)
  }

  /** Gate 4 — record that the user reviewed the AI-proposed connections. */
  @Post(':conceptId/connections/reviewed')
  markConnectionsReviewed(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.promotion.markConnectionsReviewed(user.userId, conceptId)
  }

  /** Gate 3 — generate a retrieval prompt from the articulation. */
  @Post(':conceptId/retrieval')
  generateRetrieval(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.promotion.generateRetrieval(user.userId, conceptId)
  }

  /** Gate 3 — submit a from-memory recall for grading. */
  @Post(':conceptId/retrieval/answer')
  answerRetrieval(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: AnswerRetrievalDto,
  ) {
    return this.promotion.answerRetrieval(user.userId, conceptId, dto.response)
  }

  /** Commit — re-check all gates, then atomically promote to PERMANENT. */
  @Post(':conceptId/commit')
  commit(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: CommitPromotionDto,
  ) {
    return this.promotion.commit(user.userId, conceptId, dto)
  }

  @Delete(':conceptId')
  @HttpCode(204)
  abandon(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.promotion.abandon(user.userId, conceptId)
  }
}
