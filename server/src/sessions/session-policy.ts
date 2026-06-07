// Session selection policy (DET-198, unified in DET-310). Pure, no I/O — decides
// how many items a session should hold and in what order, from already-
// categorized candidates. Kept separate so the orchestration rules are unit-
// testable without a database.
//
// Rules:
//  - target length drives the count, clamped to a 5–15 item window
//  - CONTESTED concepts get priority when present
//  - then DUE concepts, soonest-scheduled first
//  - a DORMANT concept surfaces occasionally as a "rediscovery" item
//  - approved Spaced Review prompts (DET-310) are drawn from the SAME queue and
//    INTERLEAVED with the concept items rather than batched by source —
//    interleaving aids discrimination
//  - never the same easy concepts every time (contested/dormant break monotony)

export type QueueReason =
  | 'DUE'
  | 'CONTESTED'
  | 'REDISCOVERY'
  | 'CHALLENGE'
  | 'ARTICLE_PROMPT'

/** Minimal concept shape the policy needs. */
export interface Candidate {
  id: string
  nextReviewAt: Date | null
}

/** An approved review prompt available for resurfacing (DET-310). `nextReviewAt`
 *  null means never scheduled, i.e. immediately due. */
export interface PromptCandidate {
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
  /** Approved review prompts due for resurfacing (DET-310). Optional so the
   *  concept-only callers keep working unchanged. */
  prompts?: PromptCandidate[]
}

/** A queue entry is EITHER a concept item (conceptId set) or a review-prompt
 *  item (reviewPromptId set), tagged with why it surfaced. */
export interface QueueEntry {
  conceptId?: string
  reviewPromptId?: string
  reason: QueueReason
}

/** Roughly how long one item takes in a session (minutes). */
const MINUTES_PER_CONCEPT = 1.5
export const MIN_ITEMS = 5
export const MAX_ITEMS = 15
/** At most this many rediscovery (dormant) items per session, to keep the loop
 *  forward-moving rather than an archive trawl. */
const MAX_REDISCOVERY = 1

/** Target item count for a session of `targetMinutes`, clamped to [5, 15]. */
export function targetCount(targetMinutes: number): number {
  const raw = Math.round(targetMinutes / MINUTES_PER_CONCEPT)
  return Math.max(MIN_ITEMS, Math.min(MAX_ITEMS, raw))
}

/** Soonest-scheduled first; never-scheduled (null) leads. */
function byDue(
  a: { nextReviewAt: Date | null },
  b: { nextReviewAt: Date | null },
): number {
  if (a.nextReviewAt === null) return b.nextReviewAt === null ? 0 : -1
  if (b.nextReviewAt === null) return 1
  return a.nextReviewAt.getTime() - b.nextReviewAt.getTime()
}

/**
 * Build the ordered session queue from categorized candidates. The concept
 * stream is CONTESTED first, then DUE (soonest first), then up to
 * {@link MAX_REDISCOVERY} dormant rediscovery item(s); concepts are deduped by
 * id (a concept appears once). The approved-prompt stream is sorted soonest-due
 * first. The two streams are then INTERLEAVED (a concept leads each round, so a
 * CONTESTED concept still surfaces first) and the result is capped at the target
 * count. Returns [] when nothing is available — the caller handles the empty
 * state.
 */
export function buildQueue(
  categorized: CategorizedCandidates,
  targetMinutes: number,
): QueueEntry[] {
  const limit = targetCount(targetMinutes)
  const seen = new Set<string>()

  // --- Concept stream: contested, due (soonest first), ≤1 rediscovery ---------
  const conceptStream: QueueEntry[] = []
  const pushConcept = (c: Candidate, reason: QueueReason) => {
    if (seen.has(c.id)) return
    seen.add(c.id)
    conceptStream.push({ conceptId: c.id, reason })
  }
  for (const c of categorized.contested) pushConcept(c, 'CONTESTED')
  for (const c of [...categorized.due].sort(byDue)) pushConcept(c, 'DUE')
  let rediscovered = 0
  for (const c of categorized.dormant) {
    if (rediscovered >= MAX_REDISCOVERY) break
    if (seen.has(c.id)) continue
    pushConcept(c, 'REDISCOVERY')
    rediscovered++
  }

  // --- Prompt stream: approved prompts, soonest-due first (nulls lead) --------
  const promptStream: QueueEntry[] = [...(categorized.prompts ?? [])]
    .sort(byDue)
    .map((p) => ({ reviewPromptId: p.id, reason: 'ARTICLE_PROMPT' as const }))

  // --- Interleave the two streams, capping at the target count ---------------
  const queue: QueueEntry[] = []
  let ci = 0
  let pi = 0
  while (
    queue.length < limit &&
    (ci < conceptStream.length || pi < promptStream.length)
  ) {
    if (ci < conceptStream.length) queue.push(conceptStream[ci++])
    if (queue.length >= limit) break
    if (pi < promptStream.length) queue.push(promptStream[pi++])
  }

  return queue
}
