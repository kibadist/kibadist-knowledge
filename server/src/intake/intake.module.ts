import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { SearchModule } from '../search/search.module'
import { SourceQaModule } from '../source-qa/source-qa.module'
import { IntakeController } from './intake.controller'
import { IntakeService } from './intake.service'

@Module({
  imports: [AiModule, SearchModule, SourceQaModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
