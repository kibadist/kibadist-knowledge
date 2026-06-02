import { Module } from '@nestjs/common'

import { ConceptsModule } from '../concepts/concepts.module'
import { WorkspacesModule } from '../workspaces/workspaces.module'
import { TrackConceptsController } from './track-concepts.controller'
import { TracksController } from './tracks.controller'
import { TracksService } from './tracks.service'

/**
 * Tracks (DET-235): the goal-directed layer + TrackConcept membership with
 * derived per-track progress. Imports WorkspacesModule (active-workspace
 * resolution) and ConceptsModule (ownership / non-inbox checks). PrismaModule is
 * @Global. Exports TracksService for the track-first onboarding flow (DET-240)
 * and the track-scoped graph (DET-236).
 */
@Module({
  imports: [WorkspacesModule, ConceptsModule],
  controllers: [TracksController, TrackConceptsController],
  providers: [TracksService],
  exports: [TracksService],
})
export class TracksModule {}
