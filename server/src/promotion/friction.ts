// Adaptive Friction core (DET-197). Pure, no I/O. Friction is allocated by the
// cognitive WEIGHT of an item, not applied uniformly — a familiar quick clip
// shouldn't face the same gate as a brand-new concept in a core domain. This
// module proposes a level (with human-readable reasons) from cheap signals, and
// maps a level to which Proof-of-Learning gates are required.
//
// The system PROPOSES; the user may escalate or de-escalate. The caller is
// responsible for never SILENTLY downgrading a Deep concept (DET-197 rule).

import { FrictionLevel, GateMode } from '@kibadist/prisma'

/** Signals used to propose a friction level. All cheap to compute at gate time. */
export interface FrictionSignals {
  /** Semantic novelty in [0,1] = 1 − max similarity to the user's concepts.
   *  High = unfamiliar territory. */
  novelty: number
  /** The user explicitly flagged "this matters". */
  importance: boolean
  /** Length of the captured source (chars) — a rough conceptual-weight proxy. */
  sourceLength: number
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
 * Propose a friction level from the signals, with reasons. Heuristic and
 * deliberately legible: importance or genuine novelty pushes toward DEEP; a
 * short, familiar, unflagged clip drops to MINIMAL; the routine middle is LIGHT.
 * RIGOROUS is never auto-proposed — it is a deliberate user escalation for
 * publication-grade claims.
 */
export function proposeFriction(signals: FrictionSignals): FrictionProposal {
  const reasons: string[] = []
  let level: FrictionLevel = FrictionLevel.LIGHT

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

  // A short, familiar, unflagged clip earns the lightest treatment.
  if (
    !signals.importance &&
    signals.novelty < NOVELTY_HIGH &&
    signals.sourceLength < TRIVIAL_CHARS
  ) {
    return {
      level: FrictionLevel.MINIMAL,
      reasons: ['A short, familiar clip — a compression is enough.'],
    }
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
