// The Proof-of-Learning Gate's pure decision core (DET-189). This holds NO I/O —
// it is the single source of truth for "has this item been earned?", so the
// guarantee can be exhaustively unit-tested and reused by both the per-step
// checklist and the final commit re-check.

import { CognitiveState, FrictionLevel } from '@kibadist/prisma'

import { requiredGates } from './friction'

/** Minimum articulation length to count as a real own-words explanation. */
export const MIN_ARTICULATION_CHARS = 10

/** Server-held proof gathered as the user works through the gate. */
export interface GateState {
  /** Gate 1: the user's own-words articulation (canonical-to-be). */
  articulation: string | null
  /**
   * Gate 1 (DET-190): whether the articulation is the user's OWN words rather
   * than a verbatim copy of the source. Computed by assessCompression against
   * the concept's source text; a copy fails the Articulate gate.
   */
  articulationIsOriginal: boolean
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
  /** Adaptive Friction level (DET-197) — decides which gates are required. */
  level: FrictionLevel
}

export interface GateChecklist {
  /** Gate 1 — articulated in their own words (always required). */
  articulate: boolean
  /** Gate 2 — connected to the graph. Auto-satisfied when the friction level
   *  doesn't require a connection (MINIMAL). */
  connect: boolean
  /** Gate 3 — passed a retrieval prompt drawn from their articulation.
   *  Auto-satisfied below DEEP friction. */
  retrieve: boolean
  /** Gate 4 — reviewed AI-proposed connections. Auto-satisfied below DEEP. */
  validate: boolean
  /** All REQUIRED gates satisfied — promotion is allowed. */
  ready: boolean
  /** Initial cognitive state the promoted concept would carry. */
  cognitiveState: CognitiveState
}

/**
 * Evaluate the proof-of-learning gates. Pure and total — no exceptions, no I/O.
 *
 * Which gates are REQUIRED is set by the Adaptive Friction level (DET-197): a
 * MINIMAL clip needs only a compression, LIGHT adds a connection, DEEP/RIGOROUS
 * demand the full gate. Each gate boolean reports "satisfied OR not required",
 * so the UI shows it green when it isn't blocking, and `ready` is simply all
 * gates true.
 *
 * Gate semantics:
 * - articulate: a non-trivial articulation exists AND it is the user's own words,
 *               not a verbatim copy of the source (DET-190). Always required.
 * - connect:   at least one real link (a deliberate standalone root therefore
 *              only promotes at MINIMAL, where connect isn't required).
 * - retrieve:  a server-graded recall passed the level's threshold.
 * - validate:  the user consciously reviewed the AI's proposed connections.
 */
export function evaluateGates(
  state: GateState,
  decision: ConnectionDecision,
): GateChecklist {
  const req = requiredGates(decision.level)

  const articulateSatisfied =
    !!state.articulation &&
    state.articulation.trim().length >= MIN_ARTICULATION_CHARS &&
    state.articulationIsOriginal

  const hasLink = decision.connectionCount >= 1

  // Each gate is "satisfied, or not required at this friction level".
  const articulate = !req.articulate || articulateSatisfied
  const connect = !req.connect || hasLink
  const retrieve = !req.retrieve || state.retrievalPassed
  const validate = !req.validate || decision.connectionsReviewed

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
