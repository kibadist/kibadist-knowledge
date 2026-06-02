import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common'

import type { AuthUser } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { AddTrackConceptDto } from './dto/add-track-concept.dto'
import { UpdateTrackConceptDto } from './dto/update-track-concept.dto'
import { TracksService } from './tracks.service'

// Track ⇄ Concept membership (DET-235), nested under a track. A concept enters as
// a CANDIDATE and is accepted/completed/skipped, re-weighted, re-depthed, or
// reordered here. Each row carries DERIVED progress (requiredDepth vs the
// concept's live CognitiveState). Membership is organization, not promotion —
// none of these routes touch the gate (DET-189).
@Controller('tracks/:trackId/concepts')
export class TrackConceptsController {
  constructor(private readonly tracks: TracksService) {}

  // The track's concepts, in order, each with derived per-track progress.
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('trackId') trackId: string) {
    return this.tracks.listConcepts(user.userId, trackId)
  }

  // Add a concept to the track (enters as CANDIDATE).
  @Post()
  add(
    @CurrentUser() user: AuthUser,
    @Param('trackId') trackId: string,
    @Body() dto: AddTrackConceptDto,
  ) {
    return this.tracks.addConcept(user.userId, trackId, dto)
  }

  // Accept/complete/skip, re-weight, change demanded depth, or reorder.
  @Patch(':conceptId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('trackId') trackId: string,
    @Param('conceptId') conceptId: string,
    @Body() dto: UpdateTrackConceptDto,
  ) {
    return this.tracks.updateConcept(user.userId, trackId, conceptId, dto)
  }

  // Remove a concept from the track (the concept itself is untouched).
  @Delete(':conceptId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('trackId') trackId: string,
    @Param('conceptId') conceptId: string,
  ) {
    await this.tracks.removeConcept(user.userId, trackId, conceptId)
  }
}
