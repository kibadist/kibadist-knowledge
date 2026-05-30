import {
  currentActivation,
  DORMANT_THRESHOLD,
  FADED_THRESHOLD,
  HALF_LIFE_DAYS,
  isDormant,
  isFaded,
} from './decay'

const DAY_MS = 24 * 60 * 60 * 1000
const base = new Date('2026-01-01T00:00:00.000Z')
const daysAfter = (n: number) => new Date(base.getTime() + n * DAY_MS)

describe('currentActivation', () => {
  it('returns the base unchanged at zero elapsed time', () => {
    expect(currentActivation(1, base, base)).toBeCloseTo(1, 10)
    expect(currentActivation(0.8, base, base)).toBeCloseTo(0.8, 10)
  })

  it('halves after exactly one half-life', () => {
    const after = currentActivation(1, base, daysAfter(HALF_LIFE_DAYS))
    expect(after).toBeCloseTo(0.5, 10)
  })

  it('quarters after two half-lives', () => {
    const after = currentActivation(1, base, daysAfter(2 * HALF_LIFE_DAYS))
    expect(after).toBeCloseTo(0.25, 10)
  })

  it('clamps the result to [0, 1]', () => {
    // A base above 1 (shouldn't happen, but guard) is clamped to 1 at t=0.
    expect(currentActivation(5, base, base)).toBe(1)
    // Far in the future the decayed value floors at ≥ 0.
    expect(
      currentActivation(1, base, daysAfter(10_000)),
    ).toBeGreaterThanOrEqual(0)
    expect(currentActivation(1, base, daysAfter(10_000))).toBeLessThanOrEqual(1)
  })

  it('treats clock skew (now before activationAt) as zero elapsed', () => {
    expect(currentActivation(1, base, daysAfter(-30))).toBeCloseTo(1, 10)
  })

  it('decreases monotonically as time elapses', () => {
    let prev = currentActivation(1, base, base)
    for (let d = 1; d <= 90; d += 1) {
      const next = currentActivation(1, base, daysAfter(d))
      expect(next).toBeLessThan(prev)
      prev = next
    }
  })
})

describe('isFaded / isDormant thresholds', () => {
  it('isFaded is true strictly below FADED_THRESHOLD', () => {
    expect(isFaded(FADED_THRESHOLD)).toBe(false)
    expect(isFaded(FADED_THRESHOLD - 1e-9)).toBe(true)
    expect(isFaded(FADED_THRESHOLD + 1e-9)).toBe(false)
  })

  it('isDormant is true strictly below DORMANT_THRESHOLD', () => {
    expect(isDormant(DORMANT_THRESHOLD)).toBe(false)
    expect(isDormant(DORMANT_THRESHOLD - 1e-9)).toBe(true)
    expect(isDormant(DORMANT_THRESHOLD + 1e-9)).toBe(false)
  })

  it('a dormant activation is also faded (DORMANT floor sits below the fade band)', () => {
    const a = DORMANT_THRESHOLD - 1e-9
    expect(isDormant(a)).toBe(true)
    expect(isFaded(a)).toBe(true)
  })
})
