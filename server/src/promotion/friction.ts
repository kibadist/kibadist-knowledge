// Adaptive Friction core (DET-197). Pure, no I/O. Friction is allocated by the
// cognitive WEIGHT of an item, not applied uniformly — a familiar quick clip
// shouldn't face the same gate as a brand-new concept in a core domain. This
// module proposes a level (with human-readable reasons) from cheap signals, and
// maps a level to which Proof-of-Learning gates are required.
//
// The system PROPOSES; the user may escalate or de-escalate. The caller is
// responsible for never SILENTLY downgrading a Deep concept (DET-197 rule).

import { FrictionLevel, GateMode, RequiredDepth } from '@kibadist/prisma'

/** Signals used to propose a friction level. All cheap to compute at gate time. */
export interface FrictionSignals {
  /** Semantic novelty in [0,1] = 1 − max similarity to the user's concepts.
   *  High = unfamiliar territory. */
  novelty: number
  /** The user explicitly flagged "this matters". */
  importance: boolean
  /** Length of the captured source (chars) — a rough conceptual-weight proxy. */
  sourceLength: number
  /**
   * First-mile learner (DET-311): the user is in their first handful of earned
   * concepts. While true, the "push" signals (importance/novelty/weight) do NOT
   * escalate above LIGHT — desirable difficulty is only desirable once the
   * learner survives it, so new users earn lightly and depth is PULLED by tracks
   * rather than pushed at every promotion. Defaults to false (experienced).
   */
  isNewLearner?: boolean
  /**
   * Track-pulled depth (DET-311): the destination track's demand on this
   * concept, when it is being earned into one. If the track demands more than
   * the baseline proposal, the level escalates to {@link TrackPull.floor} and the
   * reason is surfaced. Null/undefined when there is no target track.
   */
  track?: TrackPull | null
}

/** A destination track's pull on a concept's earning depth (DET-311). */
export interface TrackPull {
  /** The track's name, for the human-readable escalation reason. */
  name: string
  /** The friction floor the track's required depth maps to (never RIGOROUS —
   *  that stays a deliberate user escalation). */
  floor: FrictionLevel
  /** Plain-language why the track needs this depth (e.g. "needs durable recall"). */
  why: string
}

export interface FrictionProposal {
  level: FrictionLevel
  /** Why this level was proposed — shown to the user alongside the choice. */
  reasons: string[]
}

/** Which gates a level requires. A gate not required is auto-satisfied. */
export interface GateRequirements {
  articulate: boolean
  connect: boolean
  retrieve: boolean
  validate: boolean
}

/** Ordering for "advance only / never silently downgrade" comparisons. */
export const FRICTION_RANK: Record<FrictionLevel, number> = {
  MINIMAL: 0,
  LIGHT: 1,
  DEEP: 2,
  RIGOROUS: 3,
}

const NOVELTY_HIGH = 0.6 // clearly new relative to what the user knows
const WEIGHTY_CHARS = 2000 // substantial material
const TRIVIAL_CHARS = 400 // a short clip

/**
 * Gentler defaults (DET-311): below this many EARNED concepts a learner is in
 * their "first mile" and the proposal stays LIGHT regardless of push signals —
 * depth is pulled by tracks, not pushed at every promotion. Exported so the
 * promotion service and tests share the one threshold.
 */
export const NEW_LEARNER_EARNED_THRESHOLD = 5

/**
 * Map a track's required depth (DET-235) to the friction floor it pulls a
 * concept up to (DET-311). The depth ladder mirrors tracks/track-progress.ts:
 * RECOGNIZE only needs a compression, EXPLAIN needs the LIGHT articulate+connect
 * pass, and APPLY/TEACH need durable recall — the full DEEP gate. RIGOROUS is
 * never pulled automatically; it stays a deliberate user escalation.
 */
const DEPTH_FRICTION_FLOOR: Record<RequiredDepth, FrictionLevel> = {
  [RequiredDepth.RECOGNIZE]: FrictionLevel.MINIMAL,
  [RequiredDepth.EXPLAIN]: FrictionLevel.LIGHT,
  [RequiredDepth.APPLY]: FrictionLevel.DEEP,
  [RequiredDepth.TEACH]: FrictionLevel.DEEP,
}

/** Plain-language reason a given depth needs more than a light pass (DET-311). */
const DEPTH_FRICTION_WHY: Record<RequiredDepth, string> = {
  [RequiredDepth.RECOGNIZE]: 'you only need to recognize it',
  [RequiredDepth.EXPLAIN]: 'you need to explain it in your own words',
  [RequiredDepth.APPLY]: 'you need durable recall to apply it',
  [RequiredDepth.TEACH]: 'you need to defend it well enough to teach it',
}

/**
 * Build the {@link TrackPull} for a concept destined for a track with a given
 * required depth (DET-311). Pure — the caller resolves the track + depth.
 */
export function trackPullForDepth(
  name: string,
  requiredDepth: RequiredDepth,
): TrackPull {
  return {
    name,
    floor: DEPTH_FRICTION_FLOOR[requiredDepth],
    why: DEPTH_FRICTION_WHY[requiredDepth],
  }
}

/**
 * Propose a friction level from the signals, with reasons. Heuristic and
 * deliberately legible. Gentler defaults (DET-311): a first-mile learner earns
 * lightly — the push signals (importance/novelty/weight) are suppressed so the
 * baseline stays LIGHT, and the ONLY thing that lifts them above LIGHT is a
 * track that demands more depth. An experienced learner keeps the original
 * weight-driven behavior: importance or genuine novelty pushes toward DEEP and a
 * short, familiar, unflagged clip drops to MINIMAL. A destination track can pull
 * either kind of learner up to its required floor. RIGOROUS is never
 * auto-proposed — it is a deliberate user escalation for publication-grade claims.
 */
export function proposeFriction(signals: FrictionSignals): FrictionProposal {
  const reasons: string[] = []
  let level: FrictionLevel = FrictionLevel.LIGHT

  if (signals.isNewLearner) {
    // First-mile learner: earn it lightly now; depth deepens on schedule, and a
    // track (below) is the only thing that escalates. Push signals are ignored.
    reasons.push('Earn it lightly now — you can deepen it on schedule.')
  } else {
    if (signals.importance) {
      level = FrictionLevel.DEEP
      reasons.push('You marked this as important.')
    }

    if (signals.novelty >= NOVELTY_HIGH) {
      if (FRICTION_RANK[FrictionLevel.DEEP] > FRICTION_RANK[level]) {
        level = FrictionLevel.DEEP
      }
      reasons.push('This looks new relative to what you already know.')
    } else {
      reasons.push("This is close to concepts you've already earned.")
    }

    if (signals.sourceLength >= WEIGHTY_CHARS) {
      if (FRICTION_RANK[FrictionLevel.DEEP] > FRICTION_RANK[level]) {
        level = FrictionLevel.DEEP
      }
      reasons.push('It is substantial material.')
    }

    // A short, familiar, unflagged clip earns the lightest treatment — but a
    // track pull (below) can still raise it back up.
    if (
      !signals.importance &&
      signals.novelty < NOVELTY_HIGH &&
      signals.sourceLength < TRIVIAL_CHARS
    ) {
      level = FrictionLevel.MINIMAL
      reasons.length = 0
      reasons.push('A short, familiar clip — a compression is enough.')
    }
  }

  // Track-pulled depth (DET-311): if a destination track demands more than the
  // proposal so far, escalate to its floor and say why. This is the only thing
  // that lifts a first-mile learner above LIGHT — depth is pulled by intent.
  if (
    signals.track &&
    FRICTION_RANK[signals.track.floor] > FRICTION_RANK[level]
  ) {
    level = signals.track.floor
    reasons.push(
      `The “${signals.track.name}” track needs this deeper — ${signals.track.why}.`,
    )
  }

  return { level, reasons }
}

/** The gates a given friction level requires for promotion. */
export function requiredGates(level: FrictionLevel): GateRequirements {
  switch (level) {
    case FrictionLevel.MINIMAL:
      return {
        articulate: true,
        connect: false,
        retrieve: false,
        validate: false,
      }
    case FrictionLevel.LIGHT:
      return {
        articulate: true,
        connect: true,
        retrieve: false,
        validate: false,
      }
    default: // DEEP and RIGOROUS both require the full gate.
      return { articulate: true, connect: true, retrieve: true, validate: true }
  }
}

/** The retrieval-pass threshold tier for a level: DEEP/RIGOROUS demand the
 *  higher bar, the lighter levels the routine one. */
export function modeForLevel(level: FrictionLevel): GateMode {
  return level === FrictionLevel.DEEP || level === FrictionLevel.RIGOROUS
    ? GateMode.DEEP
    : GateMode.QUICK
}
