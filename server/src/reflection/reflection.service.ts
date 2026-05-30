import {
  type CognitiveState,
  ReflectionKind,
  StateTrigger,
} from '@kibadist/prisma'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { ConceptStateService } from '../concept-state/concept-state.service'
import { ConceptsService } from '../concepts/concepts.service'
import { ConnectorService } from '../connector/connector.service'
import { PrismaService } from '../prisma/prisma.service'
import { addDays } from '../retrieval/sm2'

/** One reflection the user recorded at the close of a session. */
export interface ReflectionItem {
  conceptId: string
  kind: ReflectionKind
  note?: string
}

/**
 * The next mastery state CLEARER should advance toward, or null if there is no
 * forward move (terminal/non-advancing states). Deliberately conservative: it
 * only ever moves UP the ladder (RETRIEVED → DEFENDED → INTERNALIZED) and pulls
 * pre-retrieval states (LINKED/EXPLAINED, or a reawakened DORMANT) up to
 * RETRIEVED. It NEVER demotes — "this got clearer" must not push a concept
 * backward. The trigger reuses an existing StateTrigger appropriate to the edge.
 */
function clearerTarget(
  from: CognitiveState,
): { to: CognitiveState; trigger: StateTrigger } | null {
  switch (from) {
    case 'EXPLAINED':
    case 'LINKED':
    case 'DORMANT':
      return { to: 'RETRIEVED', trigger: StateTrigger.RETRIEVAL_SUCCESS }
    case 'RETRIEVED':
      return { to: 'DEFENDED', trigger: StateTrigger.TUTOR_DEFENDED }
    case 'DEFENDED':
      return { to: 'INTERNALIZED', trigger: StateTrigger.INTERNALIZED }
    default:
      // INTERNALIZED (already mastered), SEEN/PARSED (pre-knowledge),
      // CONTESTED/ARCHIVED (handled by other flows) — no clearer advance.
      return null
  }
}

/**
 * Reflection (DET-196) — the closing step of an Understanding Session (DET-198).
 * The user notices what MOVED in their understanding; each kind carries a
 * CONCRETE downstream effect, because reflection that changes nothing is the
 * anti-behavior this feature exists to avoid:
 *  - CLEARER       → advance the concept's cognitive state one mastery step
 *  - LESS_CLEAR    → pull its next review sooner (tomorrow)
 *  - CONNECTED     → kick off a Connector pass for the user to validate
 *  - CHALLENGE_NEXT→ flag the concept for a Tutor challenge next time
 *
 * The Reflection row is the source of truth and is ALWAYS persisted first; each
 * downstream effect is best-effort and wrapped so a failed side effect never
 * loses the recorded reflection. Reflection is skippable per-prompt and must
 * never block closing the session.
 */
@Injectable()
export class ReflectionService {
  private readonly logger = new Logger(ReflectionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly conceptState: ConceptStateService,
    private readonly connector: ConnectorService,
    private readonly concepts: ConceptsService,
  ) {}

  /**
   * Record the user's reflections for a session and apply each one's downstream
   * effect. Verifies the session is owned; each item's concept must be owned +
   * non-INBOX (a bad concept throws). The Reflection row is persisted before its
   * effect is attempted, and effects are best-effort: a failure is logged and
   * swallowed so the recorded reflection always survives.
   */
  async record(userId: string, sessionId: string, items: ReflectionItem[]) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    })
    if (!session) throw new NotFoundException('Session not found')

    const created = []
    for (const item of items) {
      // A bad concept is a hard error — the caller sent an invalid reference.
      await this.concepts.assertOwnedNonInbox(userId, item.conceptId)

      const reflection = await this.prisma.reflection.create({
        data: {
          sessionId,
          userId,
          conceptId: item.conceptId,
          kind: item.kind,
          note: item.note,
        },
      })
      created.push(reflection)

      // Each effect is best-effort: it must NEVER roll back the persisted
      // reflection above. A thrown effect is logged and skipped.
      try {
        await this.applyEffect(userId, item)
      } catch (error) {
        this.logger.warn(
          `Reflection effect ${item.kind} failed for ${item.conceptId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    return created
  }

  /** Apply the downstream effect for one reflection (best-effort; may throw —
   *  the caller wraps it). */
  private async applyEffect(
    userId: string,
    item: ReflectionItem,
  ): Promise<void> {
    switch (item.kind) {
      case ReflectionKind.CLEARER: {
        const concept = await this.prisma.concept.findFirst({
          where: { id: item.conceptId, userId },
          select: { cognitiveState: true },
        })
        if (!concept) return
        const target = clearerTarget(concept.cognitiveState)
        if (!target) return
        await this.conceptState.transition({
          conceptId: item.conceptId,
          userId,
          to: target.to,
          trigger: target.trigger,
        })
        return
      }
      case ReflectionKind.LESS_CLEAR: {
        await this.prisma.concept.updateMany({
          where: { id: item.conceptId, userId },
          data: { nextReviewAt: addDays(new Date(), 1) },
        })
        return
      }
      case ReflectionKind.CONNECTED: {
        await this.connector.proposeAndPersist(userId, item.conceptId)
        return
      }
      case ReflectionKind.CHALLENGE_NEXT: {
        await this.prisma.concept.updateMany({
          where: { id: item.conceptId, userId },
          data: { tutorRequested: true },
        })
        return
      }
    }
  }

  /** Reflections for a concept (newest-first), for the "what changed" view. */
  async forConcept(userId: string, conceptId: string) {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)
    return this.prisma.reflection.findMany({
      where: { conceptId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        note: true,
        createdAt: true,
        sessionId: true,
      },
    })
  }
}
