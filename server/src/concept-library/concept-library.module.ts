import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { ConceptLibraryController } from './concept-library.controller'
import { ConceptLibraryService } from './concept-library.service'

@Module({
  imports: [AiModule],
  controllers: [ConceptLibraryController],
  providers: [ConceptLibraryService],
  exports: [ConceptLibraryService],
})
export class ConceptLibraryModule {}
