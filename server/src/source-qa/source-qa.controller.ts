import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AskQuestionDto } from './dto/ask-question.dto'
import { SourceQaService } from './source-qa.service'

/**
 * Reference Q&A (DET-208). Lets a user ask source-grounded questions while
 * reading an inbox item and get AI scaffold answers. Nothing here can write
 * canonical knowledge — promotion stays exclusively in the Proof-of-Learning Gate.
 */
@Controller('source-qa')
export class SourceQaController {
  constructor(private readonly sourceQa: SourceQaService) {}

  /** Ask a question about the source; returns a grounded reference answer. */
  @Post(':conceptId/ask')
  ask(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: AskQuestionDto,
  ) {
    return this.sourceQa.ask(user.userId, conceptId, dto)
  }

  /** Session history of reference Q&A for an item. */
  @Get(':conceptId')
  list(@CurrentUser() user: AuthUser, @Param('conceptId') conceptId: string) {
    return this.sourceQa.list(user.userId, conceptId)
  }

  /** Discard a single reference Q&A entry. */
  @Delete('entry/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.sourceQa.remove(user.userId, id)
  }
}
