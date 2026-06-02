// Derived track progress (DET-235). A track-concept stores a `requiredDepth`
// (the track's DEMAND); how far the concept has actually come toward it is NOT
// stored — it's derived here by reading that demand against the concept's live
// `CognitiveState` (DET-194). One source of truth for mastery: the state machine.
//
// The boundary: this module only READS state to compute a view. It never moves a
// concept, never shortcuts the gate — `requiredDepth` is a yardstick, not a lever.

import { CognitiveState, RequiredDepth } from '@kibadist/prisma'

/**
 * The mastery ladder: the forward progression of cognitive states toward mastery,
 * as a rank. Higher = more deeply understood. The off-ladder states are mapped
 * conservatively to reflect CURRENT reality, not peak:
 *   - DORMANT: was known but has decayed → low; the track should resurface it.
 *   - CONTESTED: an unresolved contradiction → "explained but unsettled".
 *   - ARCHIVED: retired → 0.
 * This is the single place the CognitiveState→depth ordering is defined.
 */
const STATE_RANK: Record<CognitiveState, number> = {
  [CognitiveState.SEEN]: 0,
  [CognitiveState.PARSED]: 1,
  [CognitiveState.EXPLAINED]: 2,
  [CognitiveState.LINKED]: 3,
  [CognitiveState.RETRIEVED]: 4,
  [CognitiveState.DEFENDED]: 5,
  [CognitiveState.INTERNALIZED]: 6,
  // Off-ladder (current reality, not peak).
  [CognitiveState.DORMANT]: 1,
  [CognitiveState.CONTESTED]: 2,
  [CognitiveState.ARCHIVED]: 0,
}

/**
 * The rank a given required depth demands. RECOGNIZE≈PARSED, EXPLAIN≈EXPLAINED,
 * APPLY≈RETRIEVED (can recall/use), TEACH≈DEFENDED (can defend it under
 * challenge). Kept as ranks so progress is a simple comparison.
 */
const DEPTH_REQUIRED_RANK: Record<RequiredDepth, number> = {
  [RequiredDepth.RECOGNIZE]: STATE_RANK[CognitiveState.PARSED], // 1
  [RequiredDepth.EXPLAIN]: STATE_RANK[CognitiveState.EXPLAINED], // 2
  [RequiredDepth.APPLY]: STATE_RANK[CognitiveState.RETRIEVED], // 4
  [RequiredDepth.TEACH]: STATE_RANK[CognitiveState.DEFENDED], // 5
}

export interface TrackConceptProgress {
  requiredDepth: RequiredDepth
  /** The concept's current cognitive state (echoed for the UI). */
  state: CognitiveState
  /** True once the concept's current state meets the track's demanded depth. */
  met: boolean
  /** 0..1 progress toward the demanded depth (1 = met or beyond). */
  ratio: number
  /**
   * True for states that need attention regardless of rank — a once-known
   * concept that has DORMANT-decayed or gone CONTESTED. The UI can flag these
   * even when `met` is false, so "faded" reads differently from "never learned".
   */
  needsAttention: boolean
}

/**
 * Derive a concept's progress toward what a track demands of it. Pure — no I/O.
 * `met` is a simple "is the current rank ≥ the required rank"; `ratio` gives a
 * partial-credit bar; `needsAttention` distinguishes decayed/contested from
 * merely not-yet-learned.
 */
export function trackConceptProgress(
  requiredDepth: RequiredDepth,
  state: CognitiveState,
): TrackConceptProgress {
  const required = DEPTH_REQUIRED_RANK[requiredDepth]
  const current = STATE_RANK[state]
  const met = current >= required
  const ratio =
    required === 0 ? 1 : Math.min(1, Math.max(0, current / required))
  const needsAttention =
    state === CognitiveState.DORMANT || state === CognitiveState.CONTESTED
  return { requiredDepth, state, met, ratio, needsAttention }
}
