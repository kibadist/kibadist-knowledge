import { Body, Controller, Get, Post, Query } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { CreateRetrievalEventDto } from './dto/create-retrieval-event.dto'
import { RetrievalService } from './retrieval.service'

@Controller('retrieval-events')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('conceptId') conceptId?: string) {
    return this.retrievalService.findAllForUser(user.userId, conceptId)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRetrievalEventDto) {
    return this.retrievalService.create(user.userId, dto)
  }
}
