import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptsModule } from '../concepts/concepts.module'
import { LivingConceptController } from './living-concept.controller'
import { LivingConceptService } from './living-concept.service'

/**
 * Living Concepts (DET-230). Imports ConceptsModule for the owned + non-INBOX
 * boundary check, and AiModule for persona seeding (which degrades to a
 * deterministic stub when AI is unavailable). PrismaModule is @Global.
 */
@Module({
  imports: [AiModule, ConceptsModule],
  controllers: [LivingConceptController],
  providers: [LivingConceptService],
})
export class LivingConceptModule {}
