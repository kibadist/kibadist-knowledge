import {
  type CognitiveState,
  ConceptStatus,
  LinkStatus,
  type RetrievalEvent,
  StateTrigger,
} from '@kibadist/prisma'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { ConceptStateService } from '../concept-state/concept-state.service'
import { ConceptsService } from '../concepts/concepts.service'
import { DecayService } from '../decay/decay.service'
import { PrismaService } from '../prisma/prisma.service'
import { generateCards, type RetrievalCard } from './cards'
import type { CreateRetrievalEventDto } from './dto/create-retrieval-event.dto'
import { addDays, PASS_QUALITY, scheduleNext } from './sm2'

/**
 * Mastery ordering used to decide whether a passing recall should ADVANCE a
 * concept's cognitive state. A retrieval only moves a concept to a higher-rank
 * state; it never demotes (a post-lapse pass must not drag INTERNALIZED back to
 * RETRIEVED). SEEN/PARSED/DORMANT/CONTESTED share the "pre-mastery" rank — a
 * passing recall from any of them advances to RETRIEVED.
 */
const MASTERY_RANK: Record<CognitiveState, number> = {
  ARCHIVED: -1,
  SEEN: 0,
  PARSED: 0,
  EXPLAINED: 1,
  LINKED: 1,
  DORMANT: 1,
  CONTESTED: 1,
  RETRIEVED: 2,
  DEFENDED: 3,
  INTERNALIZED: 4,
}

/** A concept due for resurfacing, in the order the scheduler wants to review it. */
export interface DueConcept {
  id: string
  title: string
  cognitiveState: CognitiveState
  nextReviewAt: Date | null
}

/** The result of grading a retrieval: the new schedule and resulting state. */
export interface GradeResult {
  reviewEase: number
  reviewIntervalDays: number
  reviewReps: number
  nextReviewAt: Date
  cognitiveState: CognitiveState
}

/** A graded recall attempt. `score` is the 0–5 SM-2 quality; `question`/
 *  `response` are the card context recorded on the RetrievalEvent. */
export interface GradeRetrievalInput {
  question?: string
  response?: string
  score: number
}

/**
 * The Retrieval Engine (DET-192). Schedules and records spaced resurfacing of
 * earned concepts, and drives the cognitive state forward on sustained recall
 * success. The cards a user is tested on come from THEIR OWN COMPRESSION (latest
 * articulation) plus the edges they approved — NEVER from the source document.
 * That guarantee lives in {@link cardsFor} (and the pure {@link generateCards}).
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
    private readonly conceptState: ConceptStateService,
    private readonly decay: DecayService,
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

  /**
   * Concepts due for resurfacing (DET-192): owned, earned (non-INBOX), neither
   * ARCHIVED nor DORMANT, whose next review has come (or that were never
   * scheduled). DORMANT is EXCLUDED from active scheduling (DET-195) — a faded
   * concept has decayed out of the active pool and is surfaced instead through
   * the session's separate dormant-rediscovery bucket (DET-198), which queries
   * DORMANT directly. Ordered by `nextReviewAt` ascending with NULLs first, so
   * never-scheduled concepts (just promoted) lead the queue.
   */
  async due(userId: string, limit = 20): Promise<DueConcept[]> {
    const now = new Date()
    return this.prisma.concept.findMany({
      where: {
        userId,
        status: { not: ConceptStatus.INBOX },
        cognitiveState: { notIn: ['ARCHIVED', 'DORMANT'] },
        OR: [{ nextReviewAt: { lte: now } }, { nextReviewAt: null }],
      },
      orderBy: { nextReviewAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
      select: {
        id: true,
        title: true,
        cognitiveState: true,
        nextReviewAt: true,
      },
    })
  }

  /**
   * The retrieval cards for one concept (DET-192). Generated from the user's
   * latest articulation (their compression) + approved CONFIRMED edges only —
   * the source document is never read here. This is the non-negotiable
   * compression-not-source rule, enforced by what we query.
   */
  async cardsFor(userId: string, conceptId: string): Promise<RetrievalCard[]> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)

    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { title: true },
    })
    // assertOwnedNonInbox already guarantees existence; satisfy the type.
    const title = concept?.title ?? ''

    // The latest articulation is the canonical compression we test against.
    const latest = await this.prisma.articulation.findFirst({
      where: { conceptId, userId },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    })

    // CONFIRMED edges in both directions, with the OTHER concept's title, for
    // CONNECT cards. Only user-approved relationships — never AI suggestions.
    const [outgoing, incoming] = await Promise.all([
      this.prisma.link.findMany({
        where: {
          sourceConceptId: conceptId,
          userId,
          status: LinkStatus.CONFIRMED,
        },
        select: {
          relationKind: true,
          targetConcept: { select: { title: true } },
        },
      }),
      this.prisma.link.findMany({
        where: {
          targetConceptId: conceptId,
          userId,
          status: LinkStatus.CONFIRMED,
        },
        select: {
          relationKind: true,
          sourceConcept: { select: { title: true } },
        },
      }),
    ])

    const edges = [
      ...outgoing.map((l) => ({
        targetTitle: l.targetConcept.title,
        relationKind: l.relationKind,
      })),
      ...incoming.map((l) => ({
        targetTitle: l.sourceConcept.title,
        relationKind: l.relationKind,
      })),
    ]

    return generateCards({ title, articulation: latest?.body ?? '', edges })
  }

  /**
   * Grade a retrieval and reschedule (DET-192). Atomically records the
   * {@link RetrievalEvent} and advances the SM-2 schedule (these MUST commit
   * together). A PASS then drives the cognitive state forward — RETRIEVED, or
   * INTERNALIZED once recall has been sustained (reps ≥ 3) — best-effort: an
   * illegal transition (e.g. already INTERNALIZED) is caught and logged, and
   * never rolls back the recorded event + schedule. A lapse (score < 3) records
   * the event and pulls the next review sooner but leaves the state untouched
   * (decay is DET-195).
   */
  async grade(
    userId: string,
    conceptId: string,
    dto: GradeRetrievalInput,
  ): Promise<GradeResult> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)

    // The recorded event, the SM-2 schedule update, and the cognitive-state move
    // all commit together (the transition joins via `tx`); the returned state is
    // read inside the tx, so no post-commit re-read is needed.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.retrievalEvent.create({
        data: {
          conceptId,
          userId,
          question: dto.question,
          response: dto.response,
          score: dto.score,
        },
      })

      const concept = await tx.concept.findFirst({
        where: { id: conceptId, userId },
        select: {
          reviewEase: true,
          reviewIntervalDays: true,
          reviewReps: true,
          cognitiveState: true,
        },
      })
      // assertOwnedNonInbox ran above; if the row vanished concurrently, abort
      // the whole tx rather than writing an event/schedule for a gone concept.
      if (!concept) throw new NotFoundException('Concept not found')

      const next = scheduleNext(
        {
          ease: concept.reviewEase,
          intervalDays: concept.reviewIntervalDays,
          reps: concept.reviewReps,
        },
        dto.score,
      )
      const nextReviewAt = addDays(new Date(), next.intervalDays)

      await tx.concept.updateMany({
        where: { id: conceptId, userId },
        data: {
          reviewEase: next.ease,
          reviewIntervalDays: next.intervalDays,
          reviewReps: next.reps,
          nextReviewAt,
        },
      })

      // State move on a PASS only. Sustained success (reps ≥ 3) earns
      // INTERNALIZED, but that edge is legal only once a concept is already
      // RETRIEVED/DEFENDED. So we build a candidate chain [INTERNALIZED?,
      // RETRIEVED] and attempt them in order, skipping any that wouldn't
      // ADVANCE mastery — this both (a) recovers a concept whose earlier
      // RETRIEVED move was missed (it still advances to RETRIEVED instead of
      // stranding at EXPLAINED) and (b) never demotes an already-mastered
      // concept (a post-lapse pass won't drag INTERNALIZED back to RETRIEVED).
      const pass = dto.score >= PASS_QUALITY
      const candidates: CognitiveState[] = pass
        ? next.reps >= 3
          ? ['INTERNALIZED', 'RETRIEVED']
          : ['RETRIEVED']
        : []

      let cognitiveState: CognitiveState = concept.cognitiveState
      for (const to of candidates) {
        if (MASTERY_RANK[to] <= MASTERY_RANK[cognitiveState]) continue
        try {
          cognitiveState = await this.conceptState.transition(
            {
              conceptId,
              userId,
              to,
              trigger:
                to === 'INTERNALIZED'
                  ? StateTrigger.INTERNALIZED
                  : StateTrigger.RETRIEVAL_SUCCESS,
            },
            tx,
          )
          break
        } catch (error) {
          // An illegal transition must not roll back the recorded event +
          // schedule; fall through to the next (lower) candidate.
          this.logger.warn(
            `Retrieval state transition to ${to} skipped for ${conceptId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }

      return {
        reviewEase: next.ease,
        reviewIntervalDays: next.intervalDays,
        reviewReps: next.reps,
        nextReviewAt,
        cognitiveState,
      }
    })

    // A review is engagement: refresh the concept's activation so decay restarts
    // (DET-195). Best-effort and OUTSIDE the tx — keeping a concept prominent must
    // never roll back the recorded event + schedule.
    try {
      await this.decay.refresh(userId, conceptId)
    } catch (error) {
      this.logger.warn(
        `Decay refresh after grade skipped for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    return result
  }
}
