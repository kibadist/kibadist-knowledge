import { Module } from '@nestjs/common'

import { ConceptsModule } from '../concepts/concepts.module'
import { SearchModule } from '../search/search.module'
import { ArticulationsController } from './articulations.controller'
import { ArticulationsService } from './articulations.service'

@Module({
  imports: [ConceptsModule, SearchModule],
  controllers: [ArticulationsController],
  providers: [ArticulationsService],
})
export class ArticulationsModule {}
