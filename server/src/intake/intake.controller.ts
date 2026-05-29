import { Body, Controller, Get, Param, Post } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { SaveAnswersDto } from './dto/save-answers.dto'
import { IntakeService } from './intake.service'

@Controller('intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  /** Open an inbox item for processing — generates questions on first call. */
  @Post(':conceptId/questions')
  generate(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.intake.getOrGenerate(user.userId, conceptId)
  }

  @Get(':conceptId')
  get(@CurrentUser() user: AuthUser, @Param('conceptId') conceptId: string) {
    return this.intake.get(user.userId, conceptId)
  }

  @Post(':conceptId/answers')
  saveAnswers(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: SaveAnswersDto,
  ) {
    return this.intake.saveAnswers(user.userId, conceptId, dto)
  }
}
