import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AI_THROTTLE } from '../throttler/ai-throttle.constant'
import { CreateLivingConceptDto } from './dto/create-living-concept.dto'
import { UpdateLivingConceptDto } from './dto/update-living-concept.dto'
import { LivingConceptService } from './living-concept.service'

// Living Concepts (DET-230): persona scaffolds over already-earned concepts.
@Controller('living-concepts')
export class LivingConceptController {
  constructor(private readonly livingConcept: LivingConceptService) {}

  // Seeds a DRAFT persona — paid AI path, so the strict `ai` throttler applies.
  // Degrades to a deterministic stub if AI is unavailable (never 500s).
  @Throttle(AI_THROTTLE)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLivingConceptDto) {
    return this.livingConcept.create(user.userId, dto)
  }

  @Get('concept/:conceptId')
  findForConcept(
    @CurrentUser() user: AuthUser,
    @Param('conceptId') conceptId: string,
  ) {
    return this.livingConcept.findForConcept(user.userId, conceptId)
  }

  // Edit the persona; status=USER_VALIDATED is how the user validates it.
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateLivingConceptDto,
  ) {
    return this.livingConcept.update(user.userId, id, dto)
  }
}
