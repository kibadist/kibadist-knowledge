// Session selection policy (DET-198). Pure, no I/O — decides how many concepts a
// session should hold and in what order, from already-categorized candidates.
// Kept separate so the orchestration rules are unit-testable without a database.
//
// Rules (from the ticket):
//  - target length drives the count, clamped to a 5–15 concept window
//  - CONTESTED concepts get priority when present
//  - then DUE concepts, soonest-scheduled first
//  - a DORMANT concept surfaces occasionally as a "rediscovery" item
//  - never the same easy concepts every time (contested/dormant break monotony)

export type QueueReason = 'DUE' | 'CONTESTED' | 'REDISCOVERY' | 'CHALLENGE'

/** Minimal concept shape the policy needs. */
export interface Candidate {
  id: string
  nextReviewAt: Date | null
}

export interface CategorizedCandidates {
  /** CONTESTED concepts — highest priority. */
  contested: Candidate[]
  /** Concepts due for review (nextReviewAt ≤ now or never scheduled). */
  due: Candidate[]
  /** DORMANT concepts available for an occasional rediscovery. */
  dormant: Candidate[]
}

export interface QueueEntry {
  conceptId: string
  reason: QueueReason
}

/** Roughly how long one concept takes in a session (minutes). */
const MINUTES_PER_CONCEPT = 1.5
export const MIN_ITEMS = 5
export const MAX_ITEMS = 15
/** At most this many rediscovery (dormant) items per session, to keep the loop
 *  forward-moving rather than an archive trawl. */
const MAX_REDISCOVERY = 1

/** Target concept count for a session of `targetMinutes`, clamped to [5, 15]. */
export function targetCount(targetMinutes: number): number {
  const raw = Math.round(targetMinutes / MINUTES_PER_CONCEPT)
  return Math.max(MIN_ITEMS, Math.min(MAX_ITEMS, raw))
}

/** Soonest-scheduled first; never-scheduled (null) leads. */
function byDue(a: Candidate, b: Candidate): number {
  if (a.nextReviewAt === null) return b.nextReviewAt === null ? 0 : -1
  if (b.nextReviewAt === null) return 1
  return a.nextReviewAt.getTime() - b.nextReviewAt.getTime()
}

/**
 * Build the ordered session queue from categorized candidates. CONTESTED first,
 * then DUE (soonest first), with up to {@link MAX_REDISCOVERY} dormant
 * rediscovery item(s) appended if there's room. Deduplicates by concept id (a
 * concept can only appear once) and caps at the target count. Returns [] when
 * nothing is available — the caller handles the empty state.
 */
export function buildQueue(
  categorized: CategorizedCandidates,
  targetMinutes: number,
): QueueEntry[] {
  const limit = targetCount(targetMinutes)
  const seen = new Set<string>()
  const queue: QueueEntry[] = []

  const push = (c: Candidate, reason: QueueReason) => {
    if (queue.length >= limit || seen.has(c.id)) return
    seen.add(c.id)
    queue.push({ conceptId: c.id, reason })
  }

  // 1. Contested concepts first — unresolved conflicts deserve attention.
  for (const c of categorized.contested) push(c, 'CONTESTED')
  // 2. Due concepts, soonest-scheduled first.
  for (const c of [...categorized.due].sort(byDue)) push(c, 'DUE')
  // 3. An occasional dormant rediscovery, if the session still has room.
  let rediscovered = 0
  for (const c of categorized.dormant) {
    if (rediscovered >= MAX_REDISCOVERY || queue.length >= limit) break
    if (seen.has(c.id)) continue
    push(c, 'REDISCOVERY')
    rediscovered++
  }

  return queue
}
