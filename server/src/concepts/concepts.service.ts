import {
  CognitiveState,
  type Concept,
  ConceptStatus,
  StateTrigger,
} from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

import { ConceptStateService } from '../concept-state/concept-state.service'
import { currentActivation } from '../decay/decay'
import { DecayService } from '../decay/decay.service'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateConceptDto } from './dto/create-concept.dto'
import type { UpdateConceptDto } from './dto/update-concept.dto'

@Injectable()
export class ConceptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conceptState: ConceptStateService,
    private readonly decay: DecayService,
  ) {}

  // Inbox items are Concepts in INBOX status. They are *not* knowledge yet, so
  // they must never surface in the concept list or a concept view (DET-187).
  // Enforced here as the single read path the rest of the app uses.
  // Each concept also carries its CURRENT activation (DET-195): the stored
  // `activation` decayed by the time since `activationAt`, computed lazily on read
  // so the list can fade idle concepts without a write.
  async findAllForUser(
    userId: string,
  ): Promise<(Concept & { currentActivation: number })[]> {
    const now = new Date()
    const concepts = await this.prisma.concept.findMany({
      where: { userId, status: { not: ConceptStatus.INBOX } },
      orderBy: { createdAt: 'desc' },
    })
    return concepts.map((concept) => ({
      ...concept,
      currentActivation: currentActivation(
        concept.activation,
        concept.activationAt,
        now,
      ),
    }))
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
        // What MOVED in the user's understanding over time (DET-196), newest
        // first, for the "what changed" view.
        reflections: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, kind: true, note: true, createdAt: true },
        },
      },
    })
    if (!concept) throw new NotFoundException('Concept not found')
    // The cognitive-state history (DET-194), oldest-first. Ownership is already
    // established by the concept load above, so this is safe to attach.
    const stateHistory = await this.conceptState.history(id, userId)
    // The CURRENT activation (DET-195): stored `activation` decayed by elapsed
    // time, computed lazily on read so the view can show fade/dormant status.
    const current = currentActivation(
      concept.activation,
      concept.activationAt,
      new Date(),
    )
    return { ...concept, stateHistory, currentActivation: current }
  }

  // Always lands in the inbox (status defaults to INBOX). Promotion to a
  // permanent concept is gated and lives in PromotionService (DET-189).
  // The concept row defaults to SEEN; we write its opening `null → SEEN`
  // transition in the same commit so its cognitive history starts at capture.
  async create(userId: string, dto: CreateConceptDto): Promise<Concept> {
    return this.prisma.$transaction(async (tx) => {
      const concept = await tx.concept.create({
        data: {
          title: dto.title,
          summary: dto.summary,
          sourceText: dto.sourceText,
          userId,
        },
      })
      await this.conceptState.recordCapture(concept.id, userId, tx)
      return concept
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
   * Retire an earned concept (DET-194). Drives the user-initiated `* → ARCHIVED`
   * transition through the state machine, which logs it and is the single
   * writer of `cognitiveState`. ARCHIVED is terminal; the row is kept for its
   * history rather than deleted.
   *
   * Inbox items are NOT archived here — they are raw material, retired via the
   * inbox discard path (a hard delete). Using {@link assertOwnedNonInbox} keeps
   * the two retirement semantics distinct and prevents an INBOX concept from
   * becoming an invisible, unrecoverable ARCHIVED row (concept reads exclude
   * INBOX).
   */
  async archive(userId: string, id: string): Promise<CognitiveState> {
    await this.assertOwnedNonInbox(userId, id)
    return this.conceptState.transition({
      conceptId: id,
      userId,
      to: CognitiveState.ARCHIVED,
      trigger: StateTrigger.ARCHIVED,
    })
  }

  /**
   * Revive a faded concept (DET-195): restore full activation and, if it had
   * decayed into DORMANT, return it to a knowledge state. Delegates to
   * {@link DecayService.revive}, which does its own ownership/non-INBOX check.
   * Returns the concept's resulting cognitive state.
   */
  revive(userId: string, id: string): Promise<string> {
    return this.decay.revive(userId, id)
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
