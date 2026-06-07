/**
 * Learning-science microcopy (DET-306) — the "why this friction" lines.
 *
 * The app deliberately creates productive friction (own-words articulation,
 * retrieval before commit, predict-before-read, no prefill), but friction
 * without rationale reads as bad UX; friction WITH rationale builds buy-in. So
 * at each effort point we surface exactly one quiet line that says why the work
 * is the point — never a modal, never a hover-only tooltip.
 *
 * This mirrors the Metrics surface (DET-200), which keeps a server-provided
 * "why this is a real signal" line per metric. There is no server contract for
 * the gate/reading-mode copy, so THIS module is the single source of truth:
 * every screen imports from here so the same rationale never drifts between two
 * places. Tone is the house style — calm, editorial, no exclamation marks
 * (guarded by learning-rationale.test.ts).
 */
export const LEARNING_RATIONALE = {
  // Proof-of-Learning Gate (DET-189), one line per gate.
  // 1. Articulate.
  articulate:
    'Explaining in your own words is what moves this into long-term memory — pasting doesn’t.',
  // The verbatim-copy nudge (DET-190) is appended to the server message when the
  // articulation is too close to the source: it says why rephrasing is the work.
  articulateVerbatim:
    'Rephrasing forces the recall that copying skips — that’s the part that lasts.',
  // 2. Connect.
  connect:
    'Tying a new idea to what you already know is what makes it findable later — isolated facts are the first to fade.',
  // 3. Retrieve.
  retrieve:
    'Recalling without looking is the strongest known memory signal — stronger than re-reading.',
  // 4. Validate.
  validate:
    'Deciding which links are real is itself understanding — it’s how a connection becomes yours, not the app’s.',
  // Predict Before Reveal Mode (DET-282).
  predict: 'Guessing before reading — even wrong — improves what sticks.',
  // Rewrite-the-Block Mode (DET-285) — shown beside the peek control.
  rewritePeek: 'Peeking is fine; knowing you peeked is the point.',
} as const

export type LearningRationaleKey = keyof typeof LEARNING_RATIONALE
