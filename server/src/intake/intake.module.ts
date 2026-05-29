import { Module } from '@nestjs/common'

import { AiModule } from '../ai/ai.module'
import { SearchModule } from '../search/search.module'
import { IntakeController } from './intake.controller'
import { IntakeService } from './intake.service'

@Module({
  imports: [AiModule, SearchModule],
  controllers: [IntakeController],
  providers: [IntakeService],
})
export class IntakeModule {}
