import { Module } from '@nestjs/common'

import { ConceptsModule } from '../concepts/concepts.module'
import { LinksController } from './links.controller'
import { LinksService } from './links.service'

@Module({
  imports: [ConceptsModule],
  controllers: [LinksController],
  providers: [LinksService],
})
export class LinksModule {}
