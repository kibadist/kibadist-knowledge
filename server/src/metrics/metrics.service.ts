import { CognitiveState, LinkStatus } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { PASS_QUALITY } from '../retrieval/sm2'
import { isForward } from './mastery-rank'

/** How many days back the "understanding moved" window looks. */
const FORWARD_WINDOW_DAYS = 30

/**
 * The Anti-Vanity Metrics surface (DET-200), computed from existing rows — no
 * schema change. Every number here goes up only when the user actually
 * understands MORE: retention of what they've earned, the synthesis they've
 * built, and recent forward movement up the mastery ladder.
 *
 * NOTE: the product's anti-goals explicitly forbid "vanity metrics (notes
 * created, AI summaries generated, streaks)". So this object DELIBERATELY OMITS
 * total notes/concepts as a score, day streaks, and any "AI summaries
 * generated" count — hoarding is the problem this product exists to solve, so a
 * volume tally would reward the wrong behavior. The retention/synthesis counts
 * below are measures of UNDERSTANDING (defended, internalized, retained,
 * connections validated), not activity-by-volume.
 *
 * The exact metric names/formulas here are inferred from the project vision
 * pending the full DET-200 DoD (the ticket spec was unfetchable at build time);
 * the anti-vanity spine — retention + synthesis, never streaks/volume — is the
 * hard constraint they were chosen to honor.
 */
export interface UnderstandingMetrics {
  // --- Retention ---
  /**
   * Share of graded retrievals the user passed (recall score ≥ PASS_QUALITY),
   * as a 0..1 number, or null when nothing has been graded yet. The headline
   * "do you still understand what you earned?" signal.
   */
  retrievalSuccessRate: number | null
  retrievalsPassed: number
  retrievalsTotal: number
  /**
   * Concepts currently held at a retained depth (RETRIEVED/DEFENDED/
   * INTERNALIZED) — understanding that has survived recall, not raw volume.
   */
  conceptsRetained: number

  // --- Synthesis / depth ---
  conceptsInternalized: number
  conceptsDefended: number
  /** User-approved (CONFIRMED) edges — connections the user actually drew. */
  connectionsValidated: number
  reflectionsLogged: number

  // --- Understanding movement ---
  /**
   * Cognitive-state transitions in the last {@link FORWARD_WINDOW_DAYS} days
   * that moved a concept strictly UP the mastery ladder (see isForward). Decay,
   * contradiction, and archival are excluded — only understanding moving
   * forward counts.
   */
  forwardTransitions30d: number
}

/** The retained depth states — understanding that has survived recall. */
const RETAINED_STATES = [
  CognitiveState.RETRIEVED,
  CognitiveState.DEFENDED,
  CognitiveState.INTERNALIZED,
]

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute the user's understanding metrics from their existing rows. All
   * counts are scoped to `userId`. Reads only; nothing here mutates state.
   */
  async forUser(userId: string): Promise<UnderstandingMetrics> {
    const since = new Date(
      Date.now() - FORWARD_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    )

    const [
      retrievalsTotal,
      retrievalsPassed,
      conceptsRetained,
      conceptsInternalized,
      conceptsDefended,
      connectionsValidated,
      reflectionsLogged,
      transitions,
    ] = await Promise.all([
      // Only GRADED retrievals (score not null) count toward the rate.
      this.prisma.retrievalEvent.count({
        where: { userId, score: { not: null } },
      }),
      this.prisma.retrievalEvent.count({
        where: { userId, score: { gte: PASS_QUALITY } },
      }),
      this.prisma.concept.count({
        where: { userId, cognitiveState: { in: RETAINED_STATES } },
      }),
      this.prisma.concept.count({
        where: { userId, cognitiveState: CognitiveState.INTERNALIZED },
      }),
      this.prisma.concept.count({
        where: { userId, cognitiveState: CognitiveState.DEFENDED },
      }),
      this.prisma.link.count({
        where: { userId, status: LinkStatus.CONFIRMED },
      }),
      this.prisma.reflection.count({ where: { userId } }),
      this.prisma.conceptStateTransition.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { from: true, to: true },
      }),
    ])

    const forwardTransitions30d = transitions.filter((t) =>
      isForward(t.from, t.to),
    ).length

    return {
      retrievalSuccessRate:
        retrievalsTotal === 0 ? null : retrievalsPassed / retrievalsTotal,
      retrievalsPassed,
      retrievalsTotal,
      conceptsRetained,
      conceptsInternalized,
      conceptsDefended,
      connectionsValidated,
      reflectionsLogged,
      forwardTransitions30d,
    }
  }
}
