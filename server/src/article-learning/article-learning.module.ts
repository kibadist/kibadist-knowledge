import { Module } from '@nestjs/common'
import { ArticleLearningController } from './article-learning.controller'
import { ArticleLearningEventsService } from './article-learning-events.service'

/**
 * Persistence for the Generated Article Learning Modes event log (DET-301).
 * PrismaModule is global, so the service needs no explicit import. The contract
 * types/helpers in this directory (DET-278) are imported directly where needed
 * and are intentionally NOT providers — they are pure, not injectables.
 */
@Module({
  controllers: [ArticleLearningController],
  providers: [ArticleLearningEventsService],
  exports: [ArticleLearningEventsService],
})
export class ArticleLearningModule {}
