import {
  addDays,
  DEFAULT_EASE,
  MIN_EASE,
  PASS_QUALITY,
  scheduleNext,
} from './sm2'

const fresh = () => ({ ease: DEFAULT_EASE, intervalDays: 0, reps: 0 })

describe('scheduleNext — lapses', () => {
  it('resets reps to 0 and interval to 1, decrementing ease but never below floor', () => {
    const prev = { ease: 2.5, intervalDays: 20, reps: 4 }
    const next = scheduleNext(prev, 1) // q < PASS_QUALITY
    expect(next.reps).toBe(0)
    expect(next.intervalDays).toBe(1)
    expect(next.ease).toBeLessThan(prev.ease)
    expect(next.ease).toBeGreaterThanOrEqual(MIN_EASE)
  })

  it('clamps ease at the 1.3 floor after repeated low grades', () => {
    let state = fresh()
    for (let i = 0; i < 20; i++) state = scheduleNext(state, 0)
    expect(state.ease).toBe(MIN_EASE)
  })
})

describe('scheduleNext — the passing ladder', () => {
  it('first pass → interval 1, reps 1', () => {
    const next = scheduleNext(fresh(), PASS_QUALITY)
    expect(next.reps).toBe(1)
    expect(next.intervalDays).toBe(1)
  })

  it('second pass → interval 6, reps 2', () => {
    const first = scheduleNext(fresh(), 5)
    const second = scheduleNext(first, 5)
    expect(second.reps).toBe(2)
    expect(second.intervalDays).toBe(6)
  })

  it('third pass → interval ≈ round(6 × ease), reps 3', () => {
    const first = scheduleNext(fresh(), 5)
    const second = scheduleNext(first, 5)
    const third = scheduleNext(second, 5)
    expect(third.reps).toBe(3)
    expect(third.intervalDays).toBe(
      Math.round(second.intervalDays * third.ease),
    )
  })
})

describe('scheduleNext — quality clamping', () => {
  it('treats an out-of-range high grade (9) as 5 (a pass)', () => {
    expect(scheduleNext(fresh(), 9)).toEqual(scheduleNext(fresh(), 5))
  })

  it('treats a negative grade as 0 (a lapse)', () => {
    expect(scheduleNext(fresh(), -3)).toEqual(scheduleNext(fresh(), 0))
  })

  it('does not mutate the input state', () => {
    const prev = { ease: 2.5, intervalDays: 6, reps: 2 }
    scheduleNext(prev, 5)
    expect(prev).toEqual({ ease: 2.5, intervalDays: 6, reps: 2 })
  })
})

describe('addDays', () => {
  it('adds whole days returning a new Date', () => {
    const from = new Date('2026-01-01T00:00:00.000Z')
    const out = addDays(from, 6)
    expect(out.toISOString()).toBe('2026-01-07T00:00:00.000Z')
    expect(out).not.toBe(from)
  })

  it('adding 0 days yields the same instant', () => {
    const from = new Date('2026-05-30T12:00:00.000Z')
    expect(addDays(from, 0).getTime()).toBe(from.getTime())
  })
})
