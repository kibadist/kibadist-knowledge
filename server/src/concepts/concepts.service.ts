import { type Concept, ConceptStatus } from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import type { CreateConceptDto } from './dto/create-concept.dto'
import type { UpdateConceptDto } from './dto/update-concept.dto'

@Injectable()
export class ConceptsService {
  constructor(private readonly prisma: PrismaService) {}

  // Inbox items are Concepts in INBOX status. They are *not* knowledge yet, so
  // they must never surface in the concept list or a concept view (DET-187).
  // Enforced here as the single read path the rest of the app uses.
  findAllForUser(userId: string): Promise<Concept[]> {
    return this.prisma.concept.findMany({
      where: { userId, status: { not: ConceptStatus.INBOX } },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** Returns the concept with its articulations, edges, and recent retrievals. */
  async findOne(userId: string, id: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id, userId, status: { not: ConceptStatus.INBOX } },
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

  // Always lands in the inbox (status defaults to INBOX). Promotion to a
  // permanent concept is gated and lives in PromotionService (DET-189).
  create(userId: string, dto: CreateConceptDto): Promise<Concept> {
    return this.prisma.concept.create({
      data: {
        title: dto.title,
        summary: dto.summary,
        sourceText: dto.sourceText,
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
    // Note: status is deliberately not updatable here — only the gate moves a
    // concept between INBOX/ARTICULATED/PERMANENT (DET-189).
    return this.prisma.concept.update({
      where: { id },
      data: {
        title: dto.title,
        summary: dto.summary,
        sourceText: dto.sourceText,
      },
    })
  }

  /**
   * Throws NotFound unless the concept exists and belongs to the user.
   * Intentionally status-blind: promotion/update flows must be able to act on
   * an INBOX concept by id. Surfaces where inbox items must NOT participate
   * (articulations, links, retrieval) use {@link assertOwnedNonInbox} instead.
   */
  async assertOwned(userId: string, id: string): Promise<void> {
    const found = await this.prisma.concept.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!found) throw new NotFoundException('Concept not found')
  }

  /**
   * Like {@link assertOwned}, but also rejects INBOX items. Inbox captures are
   * not knowledge yet (DET-187): they must never gain articulations, embeddings,
   * graph links, or retrieval events. This is the single gate enforcing that.
   */
  async assertOwnedNonInbox(userId: string, id: string): Promise<void> {
    const found = await this.prisma.concept.findFirst({
      where: { id, userId, status: { not: ConceptStatus.INBOX } },
      select: { id: true },
    })
    if (!found) throw new NotFoundException('Concept not found')
  }
}
