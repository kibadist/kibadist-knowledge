// Memory decay core (DET-195). Pure, no I/O. Unused ideas fade — a concept's
// CURRENT activation is its stored `activation` decayed exponentially by the time
// elapsed since `activationAt`. Computed lazily on read (no cron): events that
// matter (retrieval, a new incoming link, a session review, a Tutor defense)
// refresh activation to 1 and re-stamp the time; everything else just ages.
//
// Decay is honest, not punitive: a long half-life, a gentle fade band, and a
// DORMANT floor that hides (never deletes) and stays revivable.

/** Half-life of activation in days — after this long untouched, prominence halves. */
export const HALF_LIFE_DAYS = 21
/** Below this current activation a concept is visually faded in listings/graph. */
export const FADED_THRESHOLD = 0.5
/** Below this it has faded enough to enter DORMANT. */
export const DORMANT_THRESHOLD = 0.15

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Days between two instants (≥ 0; clock skew clamped to 0). */
function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MS_PER_DAY)
}

/**
 * The concept's activation right now: the stored base decayed by elapsed time.
 * `base` is the activation value as of `activationAt`. Result is clamped to
 * [0, 1]. Pure — `now` is passed in.
 */
export function currentActivation(
  base: number,
  activationAt: Date,
  now: Date,
): number {
  const elapsedDays = daysBetween(activationAt, now)
  const decayed = base * 0.5 ** (elapsedDays / HALF_LIFE_DAYS)
  return Math.max(0, Math.min(1, decayed))
}

/** Faded (but not yet dormant) — dimmed in the graph/list. */
export function isFaded(activation: number): boolean {
  return activation < FADED_THRESHOLD
}

/** Faded past the floor — should enter the DORMANT state. */
export function isDormant(activation: number): boolean {
  return activation < DORMANT_THRESHOLD
}
