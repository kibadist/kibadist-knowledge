import { TransformedArticleStatus } from '@kibadist/prisma'

import { isBlockedArticleStatus } from './illustration-gate.util'

describe('isBlockedArticleStatus (DET-360)', () => {
  it('is true for BLOCKED', () => {
    expect(isBlockedArticleStatus(TransformedArticleStatus.BLOCKED)).toBe(true)
  })

  it('is false for FINAL and the in-flight states', () => {
    for (const status of [
      TransformedArticleStatus.FINAL,
      TransformedArticleStatus.QUEUED,
      TransformedArticleStatus.MODELING,
      TransformedArticleStatus.PLANNING,
      TransformedArticleStatus.GENERATING,
      TransformedArticleStatus.CHECKING,
      TransformedArticleStatus.FAILED,
    ]) {
      expect(isBlockedArticleStatus(status)).toBe(false)
    }
  })

  it('is forward-compatible with future BLOCKED_* states', () => {
    // The enum has a single BLOCKED today; the prefix check gates any future
    // granular blocked variant (e.g. BLOCKED_LOW_COVERAGE) without code changes.
    expect(
      isBlockedArticleStatus(
        'BLOCKED_LOW_COVERAGE' as TransformedArticleStatus,
      ),
    ).toBe(true)
  })
})
