// The cognitive state machine's pure decision core (DET-194). No I/O — just the
// rules for which state changes are legal. Kept separate so the guarantee can be
// exhaustively unit-tested and reused by the service and any caller that wants to
// check "can this concept move there?" without touching the database.

import { CognitiveState } from '@kibadist/prisma'

/**
 * Allowed forward/backward transitions per state. A concept may move only to a
 * state listed here for its current state. The map is total (every state has an
 * entry) so an unknown transition is always a definite "no".
 *
 * Forward moves are driven by user actions (gates, sessions, Tutor); backward
 * moves by time/retrieval history (DORMANT) or contradiction (CONTESTED).
 * ARCHIVED is terminal — retiring a concept is final for the MVP.
 *
 * Some target states are only reached by systems built in later tickets
 * (RETRIEVED → DET-192, DEFENDED → DET-193, DORMANT → DET-195, CONTESTED →
 * DET-191). They are valid edges here so those tickets only have to call
 * `transition`, not re-derive the rules.
 */
export const ALLOWED_TRANSITIONS: Record<CognitiveState, CognitiveState[]> = {
  // Capture → processing.
  [CognitiveState.SEEN]: [
    CognitiveState.PARSED,
    CognitiveState.EXPLAINED,
    CognitiveState.LINKED,
    CognitiveState.ARCHIVED,
  ],
  // Interrogator surfaced structure → promotion.
  [CognitiveState.PARSED]: [
    CognitiveState.EXPLAINED,
    CognitiveState.LINKED,
    CognitiveState.ARCHIVED,
  ],
  // Articulated. Can gain a link, be retrieved, be contested, decay, or archive.
  [CognitiveState.EXPLAINED]: [
    CognitiveState.LINKED,
    CognitiveState.RETRIEVED,
    CognitiveState.CONTESTED,
    CognitiveState.DORMANT,
    CognitiveState.ARCHIVED,
  ],
  // Connected to the graph.
  [CognitiveState.LINKED]: [
    CognitiveState.RETRIEVED,
    CognitiveState.DEFENDED,
    CognitiveState.CONTESTED,
    CognitiveState.DORMANT,
    CognitiveState.ARCHIVED,
  ],
  // Recalled at least once.
  [CognitiveState.RETRIEVED]: [
    CognitiveState.LINKED,
    CognitiveState.DEFENDED,
    CognitiveState.INTERNALIZED,
    CognitiveState.CONTESTED,
    CognitiveState.DORMANT,
    CognitiveState.ARCHIVED,
  ],
  // Survived a Tutor challenge.
  [CognitiveState.DEFENDED]: [
    CognitiveState.RETRIEVED,
    CognitiveState.INTERNALIZED,
    CognitiveState.CONTESTED,
    CognitiveState.DORMANT,
    CognitiveState.ARCHIVED,
  ],
  // Sustained mastery. Can still decay, be contested, or be re-reviewed.
  [CognitiveState.INTERNALIZED]: [
    CognitiveState.RETRIEVED,
    CognitiveState.CONTESTED,
    CognitiveState.DORMANT,
    CognitiveState.ARCHIVED,
  ],
  // Faded. Reactivated by retrieval/connection, or contested/archived.
  [CognitiveState.DORMANT]: [
    CognitiveState.RETRIEVED,
    CognitiveState.EXPLAINED,
    CognitiveState.LINKED,
    CognitiveState.CONTESTED,
    CognitiveState.ARCHIVED,
  ],
  // Unresolved contradiction. Resolution returns it to a knowledge state.
  [CognitiveState.CONTESTED]: [
    CognitiveState.EXPLAINED,
    CognitiveState.LINKED,
    CognitiveState.RETRIEVED,
    CognitiveState.DEFENDED,
    CognitiveState.INTERNALIZED,
    CognitiveState.ARCHIVED,
  ],
  // Terminal.
  [CognitiveState.ARCHIVED]: [],
}

/** True iff a concept in `from` may legally move to `to`. */
export function canTransition(
  from: CognitiveState,
  to: CognitiveState,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}
