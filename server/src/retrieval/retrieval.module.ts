import { Module } from '@nestjs/common'

import { ConceptsModule } from '../concepts/concepts.module'
import { RetrievalController } from './retrieval.controller'
import { RetrievalService } from './retrieval.service'

@Module({
  imports: [ConceptsModule],
  controllers: [RetrievalController],
  providers: [RetrievalService],
})
export class RetrievalModule {}
