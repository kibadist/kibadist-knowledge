// Scheduling for approved Spaced Review prompts (DET-310).
//
// Concept reviews run full SM-2 (DET-192, see sm2.ts), keyed off the per-concept
// ease/interval/reps the Concept row carries. A ReviewPrompt has no such state —
// it only stores `nextReviewAt` — so prompts use a deliberately simpler,
// stateless cadence: a recall-quality → interval table. The first time a prompt
// is reviewed it moves off "immediately due" (nextReviewAt null) onto this
// ladder; a strong recall pushes it further out, a weak one brings it back soon.
//
// This keeps the prompt store thin while still honouring the core spaced-review
// idea (good recall ⇒ longer gap). Pure and table-driven so it is unit-testable.

/** Days until the next review, by 0–5 recall quality. Monotonic: a better recall
 *  never schedules sooner than a worse one. */
const INTERVAL_DAYS_BY_SCORE: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 4,
  4: 8,
  5: 16,
}

/** The next review time for a prompt graded `score` (0–5), `intervalDays` after
 *  `from`. Out-of-range scores clamp into [0, 5]. */
export function nextPromptReviewAt(score: number, from: Date): Date {
  const clamped = Math.max(0, Math.min(5, Math.round(score)))
  const days = INTERVAL_DAYS_BY_SCORE[clamped]
  const next = new Date(from)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}
