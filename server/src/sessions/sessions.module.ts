import { Module } from '@nestjs/common'

import { ConceptsModule } from '../concepts/concepts.module'
import { DecayModule } from '../decay/decay.module'
import { RetrievalModule } from '../retrieval/retrieval.module'
import { SessionsController } from './sessions.controller'
import { SessionsService } from './sessions.service'

@Module({
  imports: [RetrievalModule, ConceptsModule, DecayModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
