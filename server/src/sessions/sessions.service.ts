import {
  ConceptStatus,
  type Prisma,
  SessionItemReason,
  SessionStatus,
} from '@kibadist/prisma'
import { Injectable, NotFoundException } from '@nestjs/common'

import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import type { GradeResult } from '../retrieval/retrieval.service'
import { RetrievalService } from '../retrieval/retrieval.service'
import { buildQueue, type Candidate, type QueueReason } from './session-policy'

/** Cognitive states excluded from the ordinary "due" pool — handled elsewhere
 *  (CONTESTED gets priority, DORMANT becomes a rediscovery) or never resurfaced
 *  (ARCHIVED is terminal). */
const NON_DUE_STATES = ['ARCHIVED', 'CONTESTED', 'DORMANT'] as const

/**
 * Understanding Sessions (DET-198). The daily 5–15 minute loop: a queue of
 * concepts to retrieve from memory, ordered by the pure {@link buildQueue}
 * policy. The service only categorizes owned concepts and persists the queue;
 * all selection/ordering/dedup rules live in the policy. Each review is graded
 * by the Retrieval Engine (DET-192) — this service never duplicates SM-2 or
 * state-machine logic. Reflection (DET-196) will extend {@link end}.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly retrieval: RetrievalService,
    private readonly concepts: ConceptsService,
  ) {}

  /**
   * Start a session, or resume the user's existing ACTIVE one (never two at
   * once). Categorizes owned, non-INBOX concepts into contested/due/dormant,
   * asks the policy for the ordered queue, and persists the Session + its
   * SessionItems in one transaction. Empty-state: with nothing due, surface a
   * single mastered concept as a CHALLENGE, else a DORMANT rediscovery, else a
   * zero-item session for a brand-new user.
   */
  async start(userId: string, targetMinutes = 10) {
    const existing = await this.prisma.session.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
    })
    if (existing) return this.getActive(userId)

    const now = new Date()
    const concepts = await this.prisma.concept.findMany({
      where: { userId, status: { not: ConceptStatus.INBOX } },
      select: { id: true, cognitiveState: true, nextReviewAt: true },
    })

    const toCandidate = (c: {
      id: string
      nextReviewAt: Date | null
    }): Candidate => ({ id: c.id, nextReviewAt: c.nextReviewAt })

    const contested = concepts
      .filter((c) => c.cognitiveState === 'CONTESTED')
      .map(toCandidate)
    const due = concepts
      .filter(
        (c) =>
          !NON_DUE_STATES.includes(
            c.cognitiveState as (typeof NON_DUE_STATES)[number],
          ) &&
          (c.nextReviewAt === null || c.nextReviewAt <= now),
      )
      .map(toCandidate)
    const dormant = concepts
      .filter((c) => c.cognitiveState === 'DORMANT')
      .map(toCandidate)

    let queue = buildQueue({ contested, due, dormant }, targetMinutes)

    // Empty state: keep the loop forward-moving with a single fallback item — a
    // mastered concept to challenge. (An empty queue already implies there were
    // no dormant concepts: buildQueue appends a rediscovery whenever room
    // remains, and the count is always ≥ MIN_ITEMS, so dormant.length > 0 could
    // never yield an empty queue.) A brand-new user with no INTERNALIZED concept
    // gets a zero-item session, which the UI renders as the "nothing due" state.
    if (queue.length === 0) {
      const internalized = concepts.find(
        (c) => c.cognitiveState === 'INTERNALIZED',
      )
      if (internalized) {
        queue = [{ conceptId: internalized.id, reason: 'CHALLENGE' }]
      }
    }

    const sessionId = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: { userId, targetMinutes },
      })
      if (queue.length > 0) {
        await tx.sessionItem.createMany({
          data: queue.map((entry, position) => ({
            sessionId: session.id,
            conceptId: entry.conceptId,
            position,
            reason: entry.reason as SessionItemReason,
          })),
        })
      }
      return session.id
    })

    return this.loadSession(userId, sessionId)
  }

  /** The user's ACTIVE session with its ordered items + concept titles, or null
   *  if none — used to resume. */
  async getActive(userId: string) {
    const session = await this.prisma.session.findFirst({
      where: { userId, status: SessionStatus.ACTIVE },
    })
    if (!session) return null
    return this.loadSession(userId, session.id)
  }

  /**
   * Review one concept in a session. Verifies the session is owned + ACTIVE,
   * delegates grading to the Retrieval Engine (records the event, reschedules
   * SM-2, advances cognitive state), then marks the matching SessionItem
   * reviewed with the recall score. Returns the grade result.
   */
  async reviewItem(
    userId: string,
    sessionId: string,
    conceptId: string,
    score: number,
  ): Promise<GradeResult> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId, status: SessionStatus.ACTIVE },
      select: { id: true },
    })
    if (!session) throw new NotFoundException('Active session not found')

    // The concept must actually be part of THIS session — otherwise a caller
    // could grade (and reschedule) an arbitrary owned concept "through" a
    // session it isn't in, with the item update silently matching zero rows.
    const item = await this.prisma.sessionItem.findFirst({
      where: { sessionId, conceptId },
      select: { id: true },
    })
    if (!item) {
      throw new NotFoundException('Concept is not part of this session')
    }

    const result = await this.retrieval.grade(userId, conceptId, { score })

    await this.prisma.sessionItem.update({
      where: { id: item.id },
      data: { reviewedAt: new Date(), recallScore: score },
    })

    return result
  }

  /**
   * End a session: mark it COMPLETED with an end timestamp. Idempotent if it is
   * already completed. Deliberately minimal — DET-196 (Reflection) will extend
   * this to capture the post-session prompt.
   */
  async end(userId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    })
    if (!session) throw new NotFoundException('Session not found')
    if (session.status === SessionStatus.COMPLETED) {
      return this.loadSession(userId, sessionId)
    }
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId },
      data: { status: SessionStatus.COMPLETED, endedAt: new Date() },
    })
    return this.loadSession(userId, sessionId)
  }

  /** Recent sessions for a simple history view: id, timestamps, status, and how
   *  many concepts the session held. */
  async history(userId: string, limit = 10) {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        status: true,
        _count: { select: { items: true } },
      },
    })
    return sessions.map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      status: s.status,
      itemCount: s._count.items,
    }))
  }

  /** Load a session with its items ordered by position, each carrying the
   *  concept's title for the loop UI. */
  private async loadSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: { concept: { select: { title: true } } },
        },
      },
    })
    if (!session) throw new NotFoundException('Session not found')
    return {
      id: session.id,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      targetMinutes: session.targetMinutes,
      status: session.status,
      items: session.items.map((item) => ({
        id: item.id,
        conceptId: item.conceptId,
        title: item.concept.title,
        position: item.position,
        reason: item.reason as QueueReason,
        reviewedAt: item.reviewedAt,
        recallScore: item.recallScore,
      })),
    }
  }
}
