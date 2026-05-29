import type { Concept } from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateConceptDto } from './dto/create-concept.dto'
import type { UpdateConceptDto } from './dto/update-concept.dto'

@Injectable()
export class ConceptsService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForUser(userId: string): Promise<Concept[]> {
    return this.prisma.concept.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** Returns the concept with its articulations, edges, and recent retrievals. */
  async findOne(userId: string, id: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id, userId },
      include: {
        articulations: { orderBy: { createdAt: 'desc' } },
        outgoingLinks: {
          include: { targetConcept: { select: { id: true, title: true } } },
        },
        incomingLinks: {
          include: { sourceConcept: { select: { id: true, title: true } } },
        },
        retrievalEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })
    if (!concept) throw new NotFoundException('Concept not found')
    return concept
  }

  create(userId: string, dto: CreateConceptDto): Promise<Concept> {
    return this.prisma.concept.create({
      data: {
        title: dto.title,
        summary: dto.summary,
        sourceText: dto.sourceText,
        status: dto.status,
        userId,
      },
    })
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateConceptDto,
  ): Promise<Concept> {
    await this.assertOwned(userId, id)
    return this.prisma.concept.update({
      where: { id },
      data: {
        title: dto.title,
        summary: dto.summary,
        sourceText: dto.sourceText,
        status: dto.status,
      },
    })
  }

  /** Throws NotFound unless the concept exists and belongs to the user. */
  async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.concept.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!found) throw new NotFoundException('Concept not found')
  }
}
