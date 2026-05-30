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
})
