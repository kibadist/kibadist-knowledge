import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { RecordReflectionsDto } from './dto/record-reflections.dto'
import { ReflectionService } from './reflection.service'

@Controller('reflections')
export class ReflectionController {
  constructor(private readonly reflection: ReflectionService) {}

  /** Record the session's reflections + apply each one's downstream effect. */
  @Post()
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordReflectionsDto) {
    return this.reflection.record(user.userId, dto.sessionId, dto.items)
  }

  /** The reflections recorded for one concept (newest-first). */
  @Get()
  forConcept(
    @CurrentUser() user: AuthUser,
    @Query('conceptId') conceptId?: string,
  ) {
    if (!conceptId) throw new BadRequestException('conceptId is required')
    return this.reflection.forConcept(user.userId, conceptId)
  }
}
