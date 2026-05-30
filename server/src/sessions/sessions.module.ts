import { Module } from '@nestjs/common'

import { ConceptsModule } from '../concepts/concepts.module'
import { RetrievalModule } from '../retrieval/retrieval.module'
import { SessionsController } from './sessions.controller'
import { SessionsService } from './sessions.service'

@Module({
  imports: [RetrievalModule, ConceptsModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
