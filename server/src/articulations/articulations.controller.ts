import { Body, Controller, Get, Param, Post } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { ArticulationsService } from './articulations.service'
import { CreateArticulationDto } from './dto/create-articulation.dto'

@Controller('concepts/:conceptId/articulations')
export class ArticulationsController {
  constructor(private readonly articulationsService: ArticulationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('conceptId') conceptId: string) {
    return this.articulationsService.findAllForConcept(user.userId, conceptId)
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
    @Body() dto: CreateArticulationDto,
  ) {
    return this.articulationsService.create(user.userId, conceptId, dto)
  }
}
