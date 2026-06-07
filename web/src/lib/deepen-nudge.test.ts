import { describe, expect, it } from 'vitest'

import type { DeepenNudgeInput } from './deepen-nudge'
import { DEEPEN_MIN_REPS, shouldSuggestDeepen } from './deepen-nudge'

// A lightly-earned concept that has survived enough recalls — the base case the
// deepen nudge (DET-311) targets.
const base: DeepenNudgeInput = {
  status: 'PERMANENT',
  gateMode: 'QUICK',
  cognitiveState: 'RETRIEVED',
  reviewReps: DEEPEN_MIN_REPS,
}

describe('shouldSuggestDeepen (DET-311)', () => {
  it('nudges a lightly-earned concept that keeps surviving recalls', () => {
    expect(shouldSuggestDeepen(base)).toBe(true)
  })

  it('does not nudge before enough recalls have survived', () => {
    expect(
      shouldSuggestDeepen({ ...base, reviewReps: DEEPEN_MIN_REPS - 1 }),
    ).toBe(false)
  })

  it('does not nudge a concept earned at the full DEEP gate', () => {
    expect(shouldSuggestDeepen({ ...base, gateMode: 'DEEP' })).toBe(false)
  })

  it('does not nudge a concept that is already defended or internalized', () => {
    expect(shouldSuggestDeepen({ ...base, cognitiveState: 'DEFENDED' })).toBe(
      false,
    )
    expect(
      shouldSuggestDeepen({ ...base, cognitiveState: 'INTERNALIZED' }),
    ).toBe(false)
  })

  it('does not nudge an inbox/un-earned concept', () => {
    expect(shouldSuggestDeepen({ ...base, status: 'INBOX' })).toBe(false)
    expect(shouldSuggestDeepen({ ...base, gateMode: null })).toBe(false)
  })
})
