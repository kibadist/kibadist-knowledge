// The mastery ladder's pure ordering core (DET-200). No I/O — just the rule for
// whether a cognitive-state move counts as understanding moving FORWARD. Kept
// separate from the aggregation service so it can be exhaustively unit-tested.
//
// Anti-vanity stance (DET-200): the Anti-Vanity Metrics surface counts only
// transitions that mean a concept got more understood, never raw activity. A
// move "up" the ladder is progress; sideways moves (LINKED ↔ EXPLAINED — same
// depth), decay (→ DORMANT), contradiction (→ CONTESTED), and retirement
// (→ ARCHIVED) are deliberately NOT forward, because they are not the user
// understanding more.

import { CognitiveState } from '@kibadist/prisma'

/**
 * Where each cognitive state sits on the mastery ladder. Higher rank = deeper
 * earned understanding. States that are NOT a measure of depth (DORMANT,
 * CONTESTED, ARCHIVED) are deliberately excluded — a move INTO them is never
 * forward, so they have no rank.
 *
 *   SEEN / PARSED          captured / parsed, pre-knowledge        rank 0
 *   EXPLAINED / LINKED     articulated, possibly connected         rank 1
 *   RETRIEVED              recalled from memory at least once       rank 2
 *   DEFENDED               survived a Tutor challenge               rank 3
 *   INTERNALIZED           sustained mastery                        rank 4
 */
const MASTERY_RANK: Partial<Record<CognitiveState, number>> = {
  [CognitiveState.SEEN]: 0,
  [CognitiveState.PARSED]: 0,
  [CognitiveState.EXPLAINED]: 1,
  [CognitiveState.LINKED]: 1,
  [CognitiveState.RETRIEVED]: 2,
  [CognitiveState.DEFENDED]: 3,
  [CognitiveState.INTERNALIZED]: 4,
}

/**
 * True iff `to` sits strictly HIGHER on the mastery ladder than `from` — i.e.
 * the user's understanding of the concept moved forward. A null `from` (the
 * opening capture transition) is treated as the LOWEST rank, equal to SEEN, so
 * capture → SEEN is NOT forward (no understanding has moved yet) while a first
 * move into a ranked state is. Any move into a non-depth state (DORMANT/
 * CONTESTED/ARCHIVED) is false because those states have no rank. Same-rank
 * moves (e.g. EXPLAINED → LINKED) are false.
 */
export function isForward(
  from: CognitiveState | null,
  to: CognitiveState,
): boolean {
  const toRank = MASTERY_RANK[to]
  // A move into a non-depth state (no rank) is never forward.
  if (toRank === undefined) return false
  // Null `from` is the very first transition (capture → SEEN): treat as the
  // lowest ladder rank (0), so capture → SEEN is a same-rank, non-forward move.
  const fromRank = from === null ? 0 : (MASTERY_RANK[from] ?? 0)
  return toRank > fromRank
}
