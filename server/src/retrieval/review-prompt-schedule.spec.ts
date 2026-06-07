import { nextPromptReviewAt } from './review-prompt-schedule'

describe('nextPromptReviewAt', () => {
  const from = new Date('2026-06-07T00:00:00.000Z')

  it('schedules a lapse (low recall) soon — one day out', () => {
    expect(nextPromptReviewAt(0, from).toISOString()).toBe(
      '2026-06-08T00:00:00.000Z',
    )
    expect(nextPromptReviewAt(1, from).toISOString()).toBe(
      '2026-06-08T00:00:00.000Z',
    )
  })

  it('pushes a strong recall further out', () => {
    expect(nextPromptReviewAt(5, from).toISOString()).toBe(
      '2026-06-23T00:00:00.000Z',
    )
  })

  it('is monotonic in the recall score', () => {
    const days = [0, 1, 2, 3, 4, 5].map(
      (s) =>
        (nextPromptReviewAt(s, from).getTime() - from.getTime()) /
        (24 * 60 * 60 * 1000),
    )
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBeGreaterThanOrEqual(days[i - 1])
    }
  })

  it('clamps out-of-range scores into [0, 5]', () => {
    expect(nextPromptReviewAt(9, from).toISOString()).toBe(
      nextPromptReviewAt(5, from).toISOString(),
    )
    expect(nextPromptReviewAt(-3, from).toISOString()).toBe(
      nextPromptReviewAt(0, from).toISOString(),
    )
  })

  it('does not mutate the input date', () => {
    const input = new Date('2026-06-07T00:00:00.000Z')
    nextPromptReviewAt(4, input)
    expect(input.toISOString()).toBe('2026-06-07T00:00:00.000Z')
  })
})
