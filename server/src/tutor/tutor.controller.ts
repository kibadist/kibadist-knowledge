import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AI_THROTTLE } from '../throttler/ai-throttle.constant'
import { ChallengeTutorDto } from './dto/challenge-tutor.dto'
import { RespondTutorDto } from './dto/respond-tutor.dto'
import { TutorService } from './tutor.service'

@Controller('tutor')
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  // Static route first so it can't be shadowed by the `:conceptId` param routes.
  /** Concepts the Tutor should auto-challenge — RETRIEVED but thinly connected. */
  @Get('eligible')
  eligible(@CurrentUser() user: AuthUser) {
    return this.tutor.eligible(user.userId)
  }

  /** Pose a single Socratic question for a concept. Persists nothing. */
  @Throttle(AI_THROTTLE)
  @Post(':conceptId/challenge')
  challenge(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: ChallengeTutorDto,
  ) {
    return this.tutor.challenge(user.userId, conceptId, dto.angle)
  }

  /** Persist the user's own-words response to a challenge. */
  @Post(':conceptId/respond')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: RespondTutorDto,
  ) {
    return this.tutor.respond(user.userId, conceptId, dto)
  }
}
