import { TransformedArticleStatus } from '@kibadist/prisma'

/**
 * Illustration quality gate (DET-360). Illustration planning must not produce
 * renderable, polished visuals for untrusted article content: an article that is
 * BLOCKED (low coverage, lost information, unsupported additions) or otherwise
 * fails its fidelity gate may only yield DRAFT suggestions, never auto-rendered
 * or render-eligible images.
 */

/** Reason stamped on every suggestion produced for an article that is not ready. */
export const ILLUSTRATION_QUALITY_WARNING =
  'Article did not pass quality gates — this is a draft suggestion and was not rendered.'

/**
 * True when the article status is any BLOCKED_* terminal state. The status enum
 * currently has a single `BLOCKED`, but the prefix check is forward-compatible
 * with future granular states (BLOCKED_LOW_COVERAGE, BLOCKED_LOST_INFO, …) so a
 * new blocked variant gates illustrations without touching this code.
 */
export function isBlockedArticleStatus(
  status: TransformedArticleStatus,
): boolean {
  return (
    status === TransformedArticleStatus.BLOCKED ||
    String(status).startsWith('BLOCKED')
  )
}
