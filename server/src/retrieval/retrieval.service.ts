import type { RetrievalEvent } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateRetrievalEventDto } from './dto/create-retrieval-event.dto'

@Injectable()
export class RetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
  ) {}

  findAllForUser(
    userId: string,
    conceptId?: string,
  ): Promise<RetrievalEvent[]> {
    return this.prisma.retrievalEvent.findMany({
      where: { userId, ...(conceptId ? { conceptId } : {}) },
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(
    userId: string,
    dto: CreateRetrievalEventDto,
  ): Promise<RetrievalEvent> {
    // Inbox items have no retrieval cards (DET-187) — only earned concepts.
    await this.concepts.assertOwnedNonInbox(userId, dto.conceptId)
    return this.prisma.retrievalEvent.create({
      data: {
        conceptId: dto.conceptId,
        question: dto.question,
        response: dto.response,
        score: dto.score,
        userId,
      },
    })
  }
}
