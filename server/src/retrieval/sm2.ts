// Spaced-repetition scheduler core (DET-192). Pure, no I/O — the SM-2 algorithm
// that turns a recall grade into the next review interval. Failed recalls come
// back sooner; successful ones drift further out, tuned to forgetting. Schedule
// is driven by recall SUCCESS, never by frequency or streaks (anti-gamification).
//
// Quality scale matches the gate's 0–5 recall score. q < 3 is a lapse.

/** The per-concept schedule state SM-2 maintains. */
export interface ScheduleState {
  /** SM-2 easiness factor; never below 1.3. */
  ease: number
  /** Days until the next review (the gap that just elapsed / will elapse). */
  intervalDays: number
  /** Count of consecutive successful recalls (resets to 0 on a lapse). */
  reps: number
}

/** A passing recall is quality ≥ 3 on the 0–5 scale. */
export const PASS_QUALITY = 3
export const MIN_EASE = 1.3
export const DEFAULT_EASE = 2.5

/** Clamp a quality grade into the valid 0–5 range. */
function clampQuality(q: number): number {
  if (!Number.isFinite(q)) return 0
  return Math.max(0, Math.min(5, Math.round(q)))
}

/**
 * Compute the next schedule state from the previous one and a recall grade.
 * Standard SM-2:
 *  - lapse (q < 3): reps → 0, interval → 1 day (resurface soon), ease decremented
 *  - pass: reps++, interval grows (1 → 6 → prevInterval × ease), ease adjusted
 * Ease is clamped at {@link MIN_EASE}. Returns a fresh object; never mutates input.
 */
export function scheduleNext(
  prev: ScheduleState,
  quality: number,
): ScheduleState {
  const q = clampQuality(quality)
  // SM-2 ease update, applied on every review.
  const ease = Math.max(
    MIN_EASE,
    prev.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)),
  )

  if (q < PASS_QUALITY) {
    // Lapse: start the ladder over and bring it back tomorrow.
    return { ease, intervalDays: 1, reps: 0 }
  }

  const reps = prev.reps + 1
  let intervalDays: number
  if (reps === 1) intervalDays = 1
  else if (reps === 2) intervalDays = 6
  else intervalDays = Math.max(1, Math.round(prev.intervalDays * ease))

  return { ease, intervalDays, reps }
}

/** Add whole days to a date, returning a new Date (UTC-safe via ms math). */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
}
