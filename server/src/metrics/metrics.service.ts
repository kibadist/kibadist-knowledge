import { CognitiveState, LinkStatus, StateTrigger } from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'
import { PASS_QUALITY } from '../retrieval/sm2'
import { isForward } from './mastery-rank'

/** How many days back the "understanding moved" window looks. */
const FORWARD_WINDOW_DAYS = 30

/** How many trailing weeks the retrieval-rate trend reports. */
const TREND_WEEKS = 8

/** Milliseconds in one week — the trend bucket width. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The compression-quality signal (DET-200): for concepts the user has
 * re-articulated (≥2 Articulations), did their latest articulation get SHORTER
 * than their first? Shrinking is the proxy for compression — saying the same
 * idea in fewer words means it got sharper, not that more was piled on.
 */
export interface CompressionQualityTrend {
  /** Concepts with ≥2 articulations (the only ones a trend can be read from). */
  revisitedConcepts: number
  /**
   * Fraction (0..1) of revisited concepts whose LATEST articulation is strictly
   * shorter than their FIRST. Null when there are no revisited concepts.
   */
  sharperShare: number | null
}

/** A single weekly bucket of retrieval pass rate (DET-200 history-over-time). */
export interface RetrievalTrendPoint {
  /** ISO date string for the start (UTC midnight) of the week bucket. */
  weekStart: string
  /** Passed / total graded in that week, or null if nothing was graded. */
  rate: number | null
}

/**
 * One metric paired with a one-line explanation of WHY it is a real signal of
 * understanding (DET-200 DoD). Server-provided so the "why" is a single source
 * of truth the web simply renders.
 */
export interface MetricExplanation {
  key: string
  label: string
  /** The metric's current value, pre-formatted-agnostic (raw number/null). */
  value: number | null
  explanation: string
}

/**
 * The Anti-Vanity Metrics surface (DET-200), computed from existing rows — no
 * schema change. Every number here goes up only when the user actually
 * understands MORE: retention of what they've earned, the synthesis they've
 * built, and recent forward movement up the mastery ladder.
 *
 * This now reconciles to the FULL DET-200 Definition of Done: the approved
 * metrics are retrieval success rate, synthesis events (confirmed cross-domain
 * links), compression-quality trend, transfer signals, defended/internalized
 * share, and decay recovery; each ships with a one-line "why this is a real
 * signal" explanation, plus a retrieval-rate-over-time trend so the surface
 * shows history, not just a snapshot.
 *
 * NOTE: the product's anti-goals explicitly forbid "vanity metrics (notes
 * created, AI summaries generated, streaks)". So this object DELIBERATELY OMITS
 * total notes/concepts as a score, day streaks, words written, inbox
 * throughput, time-in-app, and any "AI summaries generated" count — hoarding is
 * the problem this product exists to solve, so a volume tally would reward the
 * wrong behavior. Every count below is a measure of UNDERSTANDING (defended,
 * internalized, retained, connections validated, compression sharpening, ideas
 * reused, dormant concepts revived), not activity-by-volume.
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
  /**
   * Synthesis events: user-approved (CONFIRMED) edges — connections the user
   * actually drew between ideas. (Kept as the total confirmed links; see the
   * cross-domain TODO in {@link MetricsService.forUser}.)
   */
  connectionsValidated: number
  reflectionsLogged: number
  /**
   * Compression-quality trend: are re-articulated concepts getting sharper
   * (shorter latest articulation than first)? See {@link CompressionQualityTrend}.
   */
  compressionQualityTrend: CompressionQualityTrend
  /**
   * Transfer signals: concepts that have an incoming CONFIRMED link from a
   * concept created LATER — i.e. the idea was applied/referenced while building
   * a newer concept. (MVP approximation of cross-domain transfer; see the TODO.)
   */
  transferSignals: number
  /**
   * Defended/Internalized share: (DEFENDED + INTERNALIZED) / (non-INBOX,
   * non-ARCHIVED concepts), as a 0..1 number, or null when there are no such
   * concepts. The depth of the library, not its size.
   */
  advancedShare: number | null

  // --- Understanding movement ---
  /**
   * Cognitive-state transitions in the last {@link FORWARD_WINDOW_DAYS} days
   * that moved a concept strictly UP the mastery ladder (see isForward). Decay,
   * contradiction, and archival are excluded — only understanding moving
   * forward counts.
   */
  forwardTransitions30d: number
  /**
   * Decay recovery: REACTIVATED state transitions — dormant concepts the user
   * brought back. Recovering faded understanding is a real signal; letting it
   * rot is the anti-pattern.
   */
  decayRecovery: number

  // --- History over time ---
  /**
   * Retrieval pass rate bucketed by week for the last {@link TREND_WEEKS}
   * weeks. Satisfies the DoD's "trends, not just snapshots" with no new table;
   * other metrics aren't historized cheaply, so this stands for the trend MVP.
   */
  retrievalTrend: RetrievalTrendPoint[]

  /**
   * One-line "why this is a real signal of understanding" for each headline
   * metric, server-provided so the web renders a single source of truth.
   */
  explanations: MetricExplanation[]
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
    const now = Date.now()
    const since = new Date(now - FORWARD_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    // The oldest week bucket boundary the trend looks back to.
    const trendSince = new Date(now - TREND_WEEKS * WEEK_MS)

    const [
      retrievalsTotal,
      retrievalsPassed,
      conceptsRetained,
      conceptsInternalized,
      conceptsDefended,
      connectionsValidated,
      reflectionsLogged,
      transitions,
      decayRecovery,
      articulations,
      incomingConfirmedLinks,
      advancedConceptCount,
      gradedConceptScope,
      trendEvents,
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
      // Synthesis events: CONFIRMED edges the user actually drew.
      // TODO(DET-200): refine to DISTINCT CROSS-DOMAIN links once concepts carry
      // domain tags — cross-domain detection isn't tractable without them, so for
      // now this is the total of all CONFIRMED links (any synthesis the user
      // validated), which is still a real "connections drawn, not stored" signal.
      this.prisma.link.count({
        where: { userId, status: LinkStatus.CONFIRMED },
      }),
      this.prisma.reflection.count({ where: { userId } }),
      this.prisma.conceptStateTransition.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { from: true, to: true },
      }),
      // Decay recovery: dormant concepts the user revived.
      this.prisma.conceptStateTransition.count({
        where: { userId, trigger: StateTrigger.REACTIVATED },
      }),
      // Compression-quality trend inputs: every articulation's length proxy
      // (body length) ordered so we can pick first vs latest per concept.
      this.prisma.articulation.findMany({
        where: { userId },
        select: { conceptId: true, body: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      // Transfer signals: CONFIRMED links plus the createdAt of both ends, so we
      // can count targets reached by a LATER-created source concept.
      this.prisma.link.findMany({
        where: { userId, status: LinkStatus.CONFIRMED },
        select: {
          targetConceptId: true,
          sourceConcept: { select: { createdAt: true } },
          targetConcept: { select: { createdAt: true } },
        },
      }),
      // Defended/Internalized share numerator: DEFENDED + INTERNALIZED.
      this.prisma.concept.count({
        where: {
          userId,
          cognitiveState: {
            in: [CognitiveState.DEFENDED, CognitiveState.INTERNALIZED],
          },
        },
      }),
      // Defended/Internalized share denominator: real, live concepts — exclude
      // unprocessed inbox items and explicitly retired ones.
      this.prisma.concept.count({
        where: {
          userId,
          status: { not: 'INBOX' },
          cognitiveState: { not: CognitiveState.ARCHIVED },
        },
      }),
      // Retrieval trend inputs: graded events within the trend window.
      this.prisma.retrievalEvent.findMany({
        where: { userId, score: { not: null }, createdAt: { gte: trendSince } },
        select: { score: true, createdAt: true },
      }),
    ])

    const forwardTransitions30d = transitions.filter((t) =>
      isForward(t.from, t.to),
    ).length

    const retrievalSuccessRate =
      retrievalsTotal === 0 ? null : retrievalsPassed / retrievalsTotal
    const compressionQualityTrend =
      computeCompressionQualityTrend(articulations)
    const transferSignals = computeTransferSignals(incomingConfirmedLinks)
    const advancedShare =
      gradedConceptScope === 0
        ? null
        : advancedConceptCount / gradedConceptScope

    return {
      retrievalSuccessRate,
      retrievalsPassed,
      retrievalsTotal,
      conceptsRetained,
      conceptsInternalized,
      conceptsDefended,
      connectionsValidated,
      reflectionsLogged,
      compressionQualityTrend,
      transferSignals,
      advancedShare,
      forwardTransitions30d,
      decayRecovery,
      retrievalTrend: computeRetrievalTrend(trendEvents, now),
      explanations: buildExplanations({
        retrievalSuccessRate,
        connectionsValidated,
        sharperShare: compressionQualityTrend.sharperShare,
        transferSignals,
        advancedShare,
        decayRecovery,
        forwardTransitions30d,
      }),
    }
  }
}

/**
 * Compute the compression-quality trend from a user's articulations (already
 * ordered oldest-first). For each concept with ≥2 articulations, "sharper" means
 * the latest body is strictly shorter than the first. We use string length as
 * the cheap, schema-free proxy for compression.
 */
function computeCompressionQualityTrend(
  articulations: { conceptId: string; body: string; createdAt: Date }[],
): CompressionQualityTrend {
  // Bucket articulation body-lengths per concept, preserving the asc-by-date
  // order the query produced, so [0] is the first and [last] is the latest.
  const byConcept = new Map<string, number[]>()
  for (const a of articulations) {
    const lengths = byConcept.get(a.conceptId)
    if (lengths) lengths.push(a.body.length)
    else byConcept.set(a.conceptId, [a.body.length])
  }

  let revisitedConcepts = 0
  let sharper = 0
  for (const lengths of byConcept.values()) {
    if (lengths.length < 2) continue
    revisitedConcepts++
    const first = lengths[0]
    const latest = lengths[lengths.length - 1]
    if (latest < first) sharper++
  }

  return {
    revisitedConcepts,
    sharperShare: revisitedConcepts === 0 ? null : sharper / revisitedConcepts,
  }
}

/**
 * Count transfer signals: distinct target concepts reached by a CONFIRMED link
 * whose SOURCE concept was created LATER than the target. The idea was applied
 * or referenced while building a newer concept — understanding that transferred.
 *
 * TODO(DET-200): "different domain" is approximated as "a distinct later
 * concept" for the MVP; once concepts carry domain tags this should require the
 * source to live in a different domain than the target.
 */
function computeTransferSignals(
  links: {
    targetConceptId: string
    sourceConcept: { createdAt: Date } | null
    targetConcept: { createdAt: Date } | null
  }[],
): number {
  const transferred = new Set<string>()
  for (const link of links) {
    if (!link.sourceConcept || !link.targetConcept) continue
    if (
      link.sourceConcept.createdAt.getTime() >
      link.targetConcept.createdAt.getTime()
    ) {
      transferred.add(link.targetConceptId)
    }
  }
  return transferred.size
}

/**
 * Bucket graded retrieval events into trailing weekly windows and report the
 * pass rate per week. Buckets are aligned to `now` (most recent week last) so
 * the series reads left-to-right oldest→newest. Weeks with no graded events
 * report a null rate (no data, not a zero).
 */
function computeRetrievalTrend(
  events: { score: number | null; createdAt: Date }[],
  now: number,
): RetrievalTrendPoint[] {
  const buckets: { passed: number; total: number }[] = Array.from(
    { length: TREND_WEEKS },
    () => ({ passed: 0, total: 0 }),
  )
  const oldestStart = now - TREND_WEEKS * WEEK_MS

  for (const e of events) {
    if (e.score === null) continue
    const t = e.createdAt.getTime()
    if (t < oldestStart || t > now) continue
    // Index 0 = oldest week, TREND_WEEKS-1 = current week.
    let idx = Math.floor((t - oldestStart) / WEEK_MS)
    if (idx >= TREND_WEEKS) idx = TREND_WEEKS - 1
    if (idx < 0) idx = 0
    const bucket = buckets[idx]
    bucket.total++
    if (e.score >= PASS_QUALITY) bucket.passed++
  }

  return buckets.map((bucket, idx) => ({
    weekStart: new Date(oldestStart + idx * WEEK_MS).toISOString(),
    rate: bucket.total === 0 ? null : bucket.passed / bucket.total,
  }))
}

/**
 * Build the per-metric "why this is a real signal of understanding" lines. Kept
 * server-side as the single source of truth so the web only renders the copy.
 */
function buildExplanations(m: {
  retrievalSuccessRate: number | null
  connectionsValidated: number
  sharperShare: number | null
  transferSignals: number
  advancedShare: number | null
  decayRecovery: number
  forwardTransitions30d: number
}): MetricExplanation[] {
  return [
    {
      key: 'retrievalSuccessRate',
      label: 'Retrieval success rate',
      value: m.retrievalSuccessRate,
      explanation:
        'Recalling a concept on a delay, unaided, is the hardest proof you still understand it — not that you once read it.',
    },
    {
      key: 'connectionsValidated',
      label: 'Synthesis events',
      value: m.connectionsValidated,
      explanation:
        'Connections you confirmed between ideas are synthesis you performed — understanding shows up as links you can defend, not notes you stored.',
    },
    {
      key: 'compressionQualityTrend',
      label: 'Compression quality',
      value: m.sharperShare,
      explanation:
        'When you re-explain an idea in fewer words than before, it means the idea got sharper in your head — compression is comprehension.',
    },
    {
      key: 'transferSignals',
      label: 'Transfer signals',
      value: m.transferSignals,
      explanation:
        'Reaching back to an older idea while building a newer one is transfer — understanding that became reusable, not inert.',
    },
    {
      key: 'advancedShare',
      label: 'Defended / internalized share',
      value: m.advancedShare,
      explanation:
        'The share of your live concepts that you have defended or internalized measures the DEPTH of your library, not its size.',
    },
    {
      key: 'decayRecovery',
      label: 'Decay recovery',
      value: m.decayRecovery,
      explanation:
        'Reviving a concept that had gone dormant is real recovery of faded understanding — letting knowledge rot is the failure mode this fights.',
    },
    {
      key: 'forwardTransitions30d',
      label: 'Understanding moved (30d)',
      value: m.forwardTransitions30d,
      explanation:
        'Concepts that climbed the mastery ladder recently show understanding still moving forward — a quiet month is fine, because depth is not a streak.',
    },
  ]
}
