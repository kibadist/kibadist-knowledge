import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { ConceptsService } from './concepts.service'
import { CreateConceptDto } from './dto/create-concept.dto'
import { UpdateConceptDto } from './dto/update-concept.dto'

@Controller('concepts')
export class ConceptsController {
  constructor(private readonly conceptsService: ConceptsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.conceptsService.findAllForUser(user.userId)
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conceptsService.findOne(user.userId, id)
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConceptDto) {
    return this.conceptsService.create(user.userId, dto)
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateConceptDto,
  ) {
    return this.conceptsService.update(user.userId, id, dto)
  }

  // Retire a concept (DET-194). Terminal `* → ARCHIVED` transition via the
  // state machine.
  @Post(':id/archive')
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.conceptsService.archive(user.userId, id)
  }
}
