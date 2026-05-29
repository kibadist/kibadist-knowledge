import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { SourceQaController } from './source-qa.controller'
import { SourceQaService } from './source-qa.service'

@Module({
  imports: [AiModule],
  controllers: [SourceQaController],
  providers: [SourceQaService],
  // Exported so the Interrogator (DET-188) and Promotion/Compression (DET-190)
  // can read prior Q&A as context via SourceQaService.recentForContext.
  exports: [SourceQaService],
})
export class SourceQaModule {}
