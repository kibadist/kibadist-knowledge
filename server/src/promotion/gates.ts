// The Proof-of-Learning Gate's pure decision core (DET-189). This holds NO I/O —
// it is the single source of truth for "has this item been earned?", so the
// guarantee can be exhaustively unit-tested and reused by both the per-step
// checklist and the final commit re-check.

import { CognitiveState, GateMode } from '@kibadist/prisma'

/** Minimum articulation length to count as a real own-words explanation. */
export const MIN_ARTICULATION_CHARS = 10

/** Server-held proof gathered as the user works through the gate. */
export interface GateState {
  /** Gate 1: the user's own-words articulation (canonical-to-be). */
  articulation: string | null
  /** Gate 3: whether the server-graded recall cleared the pass threshold. */
  retrievalPassed: boolean
}

/** The user's commit-time connection decision. */
export interface ConnectionDecision {
  /** How many existing concepts the user chose to link to. */
  connectionCount: number
  /** The user explicitly declared this a new conceptual root (no links). */
  isRoot: boolean
  /** The user actually reviewed the AI-proposed connections and decided. */
  connectionsReviewed: boolean
  mode: GateMode
}

export interface GateChecklist {
  /** Gate 1 — articulated in their own words. */
  articulate: boolean
  /** Gate 2 — connected to the graph, or a deliberate root. */
  connect: boolean
  /** Gate 3 — passed a retrieval prompt drawn from their articulation. */
  retrieve: boolean
  /** Gate 4 — reviewed and decided on AI-proposed connections (never auto-applied). */
  validate: boolean
  /** All four gates satisfied — promotion is allowed. */
  ready: boolean
  /** Initial cognitive state the promoted concept would carry. */
  cognitiveState: CognitiveState
}

/**
 * Evaluate the four gates. Pure and total — no exceptions, no I/O.
 *
 * Gate semantics:
 * - articulate: a non-trivial own-words articulation exists.
 * - connect:   at least one link, OR an explicit root. DEEP mode disallows a
 *              bare root — a new core-domain concept must be placed in the graph.
 * - retrieve:  a server-graded recall passed the mode's threshold.
 * - validate:  the user consciously reviewed the AI's proposed connections and
 *              decided (the anti-auto-apply guarantee is *also* enforced
 *              structurally — the server only ever creates user-listed links).
 */
export function evaluateGates(
  state: GateState,
  decision: ConnectionDecision,
): GateChecklist {
  const articulate =
    !!state.articulation &&
    state.articulation.trim().length >= MIN_ARTICULATION_CHARS

  const hasLink = decision.connectionCount >= 1
  const connect =
    decision.mode === GateMode.DEEP
      ? hasLink // DEEP must be placed in the graph; a bare root is not enough.
      : hasLink || decision.isRoot

  const retrieve = state.retrievalPassed
  const validate = decision.connectionsReviewed

  const cognitiveState = hasLink
    ? CognitiveState.LINKED
    : CognitiveState.EXPLAINED

  return {
    articulate,
    connect,
    retrieve,
    validate,
    ready: articulate && connect && retrieve && validate,
    cognitiveState,
  }
}
