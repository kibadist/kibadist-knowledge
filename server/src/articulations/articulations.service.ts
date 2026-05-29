import type { Articulation } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateArticulationDto } from './dto/create-articulation.dto'

@Injectable()
export class ArticulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
  ) {}

  async findAllForConcept(
    userId: string,
    conceptId: string,
  ): Promise<Articulation[]> {
    await this.concepts.assertOwned(userId, conceptId)
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
    await this.concepts.assertOwned(userId, conceptId)
    return this.prisma.articulation.create({
      data: { body: dto.body, conceptId, userId },
    })
  }
}
