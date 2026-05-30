import { ConceptStatus, type Prisma, StateTrigger } from '@kibadist/prisma'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { ConceptStateService } from '../concept-state/concept-state.service'
import { PrismaService } from '../prisma/prisma.service'
import { currentActivation, isDormant } from './decay'

/**
 * Memory decay (DET-195). The I/O layer over the pure {@link currentActivation}:
 * it refreshes a concept's activation when an event keeps it alive, sweeps
 * faded concepts into DORMANT, and revives a dormant one on re-engagement.
 *
 * Decay is honest, never punitive: nothing here deletes — a faded concept is
 * only hidden (DORMANT) and stays revivable. Activation runs lazily (no cron):
 * the sweep is invoked when the user engages (e.g. at session start).
 *
 * Does its OWN ownership checks via Prisma rather than injecting ConceptsService,
 * so DecayModule can be imported by ConceptsModule without a module cycle.
 */
@Injectable()
export class DecayService {
  private readonly logger = new Logger(DecayService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly conceptState: ConceptStateService,
  ) {}

  /**
   * Re-activate a concept to full prominence: set `activation` to 1 and re-stamp
   * `activationAt` to now, so decay restarts from this moment. Cheap and
   * idempotent (a scoped `updateMany`, a no-op for an unowned id) — safe to call
   * best-effort from any event path that should keep a concept alive (a review, a
   * new incoming link, a Tutor defense). Accepts an optional transaction client to
   * join an enclosing commit.
   */
  async refresh(
    userId: string,
    conceptId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await (tx ?? this.prisma).concept.updateMany({
      where: { id: conceptId, userId },
      data: { activation: 1, activationAt: new Date() },
    })
  }

  /**
   * Sweep the user's active concepts and move any that have faded past the
   * dormant floor into DORMANT (DET-195). Loads owned, earned (non-INBOX)
   * concepts that aren't already DORMANT/ARCHIVED, computes each one's CURRENT
   * activation, and for those below the floor drives a `* → DORMANT` transition
   * through the state machine. Best-effort per concept: an illegal/failed move is
   * logged and never aborts the rest of the sweep. Returns how many concepts moved
   * to dormant. No cron — call this lazily when the user engages.
   */
  async sweep(userId: string): Promise<number> {
    const now = new Date()
    const concepts = await this.prisma.concept.findMany({
      where: {
        userId,
        status: { not: ConceptStatus.INBOX },
        cognitiveState: { notIn: ['DORMANT', 'ARCHIVED'] },
      },
      select: {
        id: true,
        activation: true,
        activationAt: true,
        cognitiveState: true,
      },
    })

    let moved = 0
    for (const concept of concepts) {
      const current = currentActivation(
        concept.activation,
        concept.activationAt,
        now,
      )
      if (!isDormant(current)) continue
      try {
        await this.conceptState.transition({
          conceptId: concept.id,
          userId,
          to: 'DORMANT',
          trigger: StateTrigger.DECAYED,
          note: 'inactivity',
        })
        moved += 1
      } catch (error) {
        this.logger.warn(
          `Decay sweep could not move ${concept.id} to DORMANT: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
    return moved
  }

  /**
   * Revive a concept the user is re-engaging with (DET-195): restore full
   * activation and, if it had faded into DORMANT, return it to a knowledge state
   * (RETRIEVED) through the state machine. Asserts the concept is owned and
   * earned (non-INBOX) first — inbox captures aren't knowledge and can't be
   * revived. The state move is best-effort (a non-DORMANT concept needs none).
   * Returns the concept's resulting cognitive state.
   */
  async revive(userId: string, conceptId: string): Promise<string> {
    const concept = await this.prisma.concept.findFirst({
      where: {
        id: conceptId,
        userId,
        status: { not: ConceptStatus.INBOX },
      },
      select: { cognitiveState: true },
    })
    if (!concept) throw new NotFoundException('Concept not found')

    await this.refresh(userId, conceptId)

    if (concept.cognitiveState !== 'DORMANT') return concept.cognitiveState

    try {
      return await this.conceptState.transition({
        conceptId,
        userId,
        to: 'RETRIEVED',
        trigger: StateTrigger.REACTIVATED,
        note: 'revived',
      })
    } catch (error) {
      this.logger.warn(
        `Revive could not reactivate ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return concept.cognitiveState
    }
  }
}
