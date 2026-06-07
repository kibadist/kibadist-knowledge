// Deepen path (DET-311): earn lightly, deepen on schedule. A concept earned at a
// LIGHT gate (Quick save / Standard → QUICK mode) that keeps surviving recalls
// has proven its worth — so rather than front-loading the full four-gate pass at
// promotion, we nudge the user later to deepen it (connect + defend). This module
// is the pure decision; the UI renders from it. No re-gating happens here — the
// nudge points at the existing connect + Tutor-defend affordances (the full
// re-gating flow is a documented follow-up).

import type { CognitiveState, ConceptStatus, GateMode } from './api'

/** Below this many consecutive surviving recalls a lightly-earned concept hasn't
 *  yet proven it deserves a deepen nudge (DET-311). */
export const DEEPEN_MIN_REPS = 3

/** States already deep enough that a deepen nudge would be noise: the concept has
 *  been defended under challenge or internalized. */
const ALREADY_DEEP: ReadonlyArray<CognitiveState> = ['DEFENDED', 'INTERNALIZED']

export interface DeepenNudgeInput {
  status: ConceptStatus
  /** The gate mode the concept was earned at (null until promoted). */
  gateMode: GateMode | null
  cognitiveState: CognitiveState
  /** Consecutive successful recalls since the last miss (DET-192). */
  reviewReps: number
}

/**
 * Should we nudge the user to deepen this concept (DET-311)? True when an EARNED
 * concept was earned lightly (QUICK gate mode — i.e. MINIMAL/LIGHT friction) yet
 * has survived enough recalls to be worth deepening, and isn't already defended
 * or internalized. Pure and side-effect-free.
 */
export function shouldSuggestDeepen(c: DeepenNudgeInput): boolean {
  return (
    c.status === 'PERMANENT' &&
    c.gateMode === 'QUICK' &&
    c.reviewReps >= DEEPEN_MIN_REPS &&
    !ALREADY_DEEP.includes(c.cognitiveState)
  )
}
