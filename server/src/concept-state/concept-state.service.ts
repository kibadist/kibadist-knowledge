import {
  type CognitiveState,
  type Prisma,
  StateTrigger,
} from '@kibadist/prisma'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { canTransition } from './transitions'

/**
 * The cognitive state machine (DET-194). The single writer of `Concept.cognitiveState`
 * and the only place that appends to the transition log, so the invariant "every
 * state change is recorded with a trigger and timestamp" holds by construction.
 *
 * Forward transitions are driven by user actions (capture, intake, promotion,
 * sessions, Tutor); backward ones by time/retrieval history (decay) or
 * contradiction. Callers pass the target state + the trigger that caused it; this
 * service validates the move against {@link canTransition} and writes the concept
 * update + the transition row atomically.
 *
 * Composability: every mutating method accepts an optional Prisma transaction
 * client so a transition can join a larger commit (e.g. promotion writes the
 * articulation, links, and the EXPLAINED/LINKED transition in one transaction).
 */
@Injectable()
export class ConceptStateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a concept's birth in the SEEN state (DET-194). The concept row itself
   * defaults to SEEN; this writes the opening `null → SEEN` transition so its
   * history starts at capture. Call inside the capture transaction.
   */
  async recordCapture(
    conceptId: string,
    userId: string,
    tx?: Prisma.TransactionClient,
    note?: string,
  ): Promise<void> {
    const db = tx ?? this.prisma
    await db.conceptStateTransition.create({
      data: {
        conceptId,
        userId,
        from: null,
        to: 'SEEN',
        trigger: StateTrigger.CAPTURE,
        note,
      },
    })
  }

  /**
   * Move a concept to `to`, recording why. No-op (returns the current state)
   * when the concept is already in `to`, so repeated triggers (e.g. a second
   * retrieval that doesn't change state) don't spam the log. Throws if the
   * transition is illegal for the current state, or if the concept isn't owned.
   *
   * @param tx optional transaction client to join an enclosing commit.
   */
  async transition(
    params: {
      conceptId: string
      userId: string
      to: CognitiveState
      trigger: StateTrigger
      note?: string
    },
    tx?: Prisma.TransactionClient,
  ): Promise<CognitiveState> {
    const { conceptId, userId, to, trigger, note } = params
    const run = async (
      db: Prisma.TransactionClient,
    ): Promise<CognitiveState> => {
      const concept = await db.concept.findFirst({
        where: { id: conceptId, userId },
        select: { cognitiveState: true },
      })
      if (!concept) throw new NotFoundException('Concept not found')

      const from = concept.cognitiveState
      // Idempotent: no change, no log entry. NOTE: this means a trigger that
      // re-fires without changing state (e.g. a second successful retrieval,
      // RETRIEVAL_SUCCESS while already RETRIEVED) writes NO transition row.
      // Repeat events of that kind are recorded by their own domain rows
      // (RetrievalEvent for DET-192), so "sustained retrieval success" must be
      // derived from those, not from the transition log. If a future ticket
      // needs same-state events in this log, allow a self-edge whitelist here.
      if (from === to) return from

      if (!canTransition(from, to)) {
        throw new BadRequestException(
          `Illegal cognitive-state transition ${from} → ${to}`,
        )
      }

      // Conditional update keyed on the state we read: if a concurrent
      // transition moved this concept since the findFirst (Prisma's default
      // isolation is READ COMMITTED), `count` is 0 and we abort rather than
      // writing a transition row whose `from` no longer matches reality.
      const updated = await db.concept.updateMany({
        where: { id: conceptId, userId, cognitiveState: from },
        data: { cognitiveState: to },
      })
      if (updated.count === 0) {
        throw new ConflictException(
          'Concept cognitive state changed concurrently — retry',
        )
      }
      await db.conceptStateTransition.create({
        data: { conceptId, userId, from, to, trigger, note },
      })
      return to
    }

    // Already inside a transaction → run directly; otherwise open one so the
    // concept update and the log row commit together.
    return tx ? run(tx) : this.prisma.$transaction(run)
  }

  /**
   * The ordered transition history for a concept (oldest first), for the concept
   * view. Caller is responsible for ownership; pass the same userId used to load
   * the concept.
   */
  history(conceptId: string, userId: string) {
    return this.prisma.conceptStateTransition.findMany({
      where: { conceptId, userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        from: true,
        to: true,
        trigger: true,
        note: true,
        createdAt: true,
      },
    })
  }
}
