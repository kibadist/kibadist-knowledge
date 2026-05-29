import type { Articulation } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import { SearchService } from '../search/search.service'
import type { CreateArticulationDto } from './dto/create-articulation.dto'

@Injectable()
export class ArticulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
    private readonly search: SearchService,
  ) {}

  async findAllForConcept(
    userId: string,
    conceptId: string,
  ): Promise<Articulation[]> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    return this.prisma.articulation.findMany({
      where: { conceptId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(
    userId: string,
    conceptId: string,
    dto: CreateArticulationDto,
  ): Promise<Articulation> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    const articulation = await this.prisma.articulation.create({
      data: { body: dto.body, conceptId, userId },
    })
    // Embed-on-write so the articulation is immediately searchable. Best-effort:
    // SearchService swallows failures, so AI downtime never blocks the write.
    await this.search.indexArticulation(articulation.id, articulation.body)
    return articulation
  }
}
