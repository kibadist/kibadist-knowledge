import {
  buildQueue,
  type CategorizedCandidates,
  MAX_ITEMS,
  MIN_ITEMS,
  targetCount,
} from './session-policy'

const empty: CategorizedCandidates = { contested: [], due: [], dormant: [] }

describe('targetCount', () => {
  it('clamps short targets up to the minimum window', () => {
    expect(targetCount(1)).toBe(MIN_ITEMS)
    expect(targetCount(5)).toBe(MIN_ITEMS)
  })

  it('scales with the target length in the middle of the range', () => {
    // 10 minutes / 1.5 ≈ 6.67 → rounds to 7.
    expect(targetCount(10)).toBe(7)
  })

  it('clamps long targets down to the maximum window', () => {
    expect(targetCount(60)).toBe(MAX_ITEMS)
  })
})

describe('buildQueue', () => {
  it('returns [] when nothing is available', () => {
    expect(buildQueue(empty, 10)).toEqual([])
  })

  it('orders CONTESTED before DUE', () => {
    const queue = buildQueue(
      {
        contested: [{ id: 'k1', nextReviewAt: null }],
        due: [{ id: 'd1', nextReviewAt: new Date('2026-01-01') }],
        dormant: [],
      },
      10,
    )
    expect(queue[0]).toEqual({ conceptId: 'k1', reason: 'CONTESTED' })
    expect(queue[1]).toEqual({ conceptId: 'd1', reason: 'DUE' })
  })

  it('sorts DUE soonest-first with nulls leading', () => {
    const queue = buildQueue(
      {
        contested: [],
        due: [
          { id: 'late', nextReviewAt: new Date('2026-03-01') },
          { id: 'never', nextReviewAt: null },
          { id: 'early', nextReviewAt: new Date('2026-01-01') },
        ],
        dormant: [],
      },
      10,
    )
    expect(queue.map((e) => e.conceptId)).toEqual(['never', 'early', 'late'])
  })

  it('appends at most one REDISCOVERY dormant item', () => {
    const queue = buildQueue(
      {
        contested: [],
        due: [{ id: 'd1', nextReviewAt: null }],
        dormant: [
          { id: 'z1', nextReviewAt: null },
          { id: 'z2', nextReviewAt: null },
        ],
      },
      10,
    )
    const rediscovery = queue.filter((e) => e.reason === 'REDISCOVERY')
    expect(rediscovery).toHaveLength(1)
    expect(rediscovery[0].conceptId).toBe('z1')
  })

  it('dedupes a concept that appears in two categories', () => {
    const queue = buildQueue(
      {
        contested: [{ id: 'shared', nextReviewAt: null }],
        due: [{ id: 'shared', nextReviewAt: new Date('2026-01-01') }],
        dormant: [],
      },
      10,
    )
    expect(queue).toEqual([{ conceptId: 'shared', reason: 'CONTESTED' }])
  })

  it('caps the queue at the target count', () => {
    const due = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      nextReviewAt: null,
    }))
    const queue = buildQueue({ contested: [], due, dormant: [] }, 10)
    expect(queue).toHaveLength(targetCount(10))
  })

  // --- DET-310: approved review prompts in the same queue --------------------

  it('interleaves approved prompts with concept items rather than batching', () => {
    const queue = buildQueue(
      {
        contested: [],
        due: [
          { id: 'd1', nextReviewAt: null },
          { id: 'd2', nextReviewAt: null },
        ],
        dormant: [],
        prompts: [
          { id: 'p1', nextReviewAt: null },
          { id: 'p2', nextReviewAt: null },
        ],
      },
      10,
    )
    // Concept leads each round, then a prompt: C P C P.
    expect(queue).toEqual([
      { conceptId: 'd1', reason: 'DUE' },
      { reviewPromptId: 'p1', reason: 'ARTICLE_PROMPT' },
      { conceptId: 'd2', reason: 'DUE' },
      { reviewPromptId: 'p2', reason: 'ARTICLE_PROMPT' },
    ])
  })

  it('keeps a CONTESTED concept first even when prompts are present', () => {
    const queue = buildQueue(
      {
        contested: [{ id: 'k1', nextReviewAt: null }],
        due: [],
        dormant: [],
        prompts: [{ id: 'p1', nextReviewAt: null }],
      },
      10,
    )
    expect(queue[0]).toEqual({ conceptId: 'k1', reason: 'CONTESTED' })
    expect(queue[1]).toEqual({ reviewPromptId: 'p1', reason: 'ARTICLE_PROMPT' })
  })

  it('builds a prompt-only queue when there are no concepts', () => {
    const queue = buildQueue(
      {
        contested: [],
        due: [],
        dormant: [],
        prompts: [
          { id: 'p1', nextReviewAt: new Date('2026-01-02') },
          { id: 'p2', nextReviewAt: new Date('2026-01-01') },
        ],
      },
      10,
    )
    // Soonest-due first.
    expect(queue.map((e) => e.reviewPromptId)).toEqual(['p2', 'p1'])
    expect(queue.every((e) => e.reason === 'ARTICLE_PROMPT')).toBe(true)
  })

  it('caps an interleaved queue at the target count, draining the longer stream', () => {
    const due = Array.from({ length: 20 }, (_, i) => ({
      id: `d${i}`,
      nextReviewAt: null,
    }))
    const prompts = Array.from({ length: 2 }, (_, i) => ({
      id: `p${i}`,
      nextReviewAt: null,
    }))
    const queue = buildQueue({ contested: [], due, dormant: [], prompts }, 10)
    expect(queue).toHaveLength(targetCount(10))
    // Both prompts make it in (they interleave early), the rest are concepts.
    expect(queue.filter((e) => e.reviewPromptId).length).toBe(2)
  })
})
