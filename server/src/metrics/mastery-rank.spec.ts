import { CognitiveState } from '@kibadist/prisma'

import { isForward } from './mastery-rank'

describe('isForward', () => {
  it('is true for moves up the mastery ladder', () => {
    expect(isForward(CognitiveState.SEEN, CognitiveState.EXPLAINED)).toBe(true)
    expect(isForward(CognitiveState.EXPLAINED, CognitiveState.RETRIEVED)).toBe(
      true,
    )
    expect(isForward(CognitiveState.RETRIEVED, CognitiveState.DEFENDED)).toBe(
      true,
    )
    expect(
      isForward(CognitiveState.DEFENDED, CognitiveState.INTERNALIZED),
    ).toBe(true)
  })

  it('treats a null `from` as the lowest rank (first capture is forward into a ranked state)', () => {
    expect(isForward(null, CognitiveState.EXPLAINED)).toBe(true)
    // ...but capture → SEEN is same rank (both lowest), so not forward.
    expect(isForward(null, CognitiveState.SEEN)).toBe(false)
  })

  it('is false for same-rank moves', () => {
    expect(isForward(CognitiveState.EXPLAINED, CognitiveState.LINKED)).toBe(
      false,
    )
    expect(isForward(CognitiveState.SEEN, CognitiveState.PARSED)).toBe(false)
  })

  it('is false for moves into non-depth states (decay / contradiction / archive)', () => {
    expect(isForward(CognitiveState.INTERNALIZED, CognitiveState.DORMANT)).toBe(
      false,
    )
    expect(isForward(CognitiveState.RETRIEVED, CognitiveState.CONTESTED)).toBe(
      false,
    )
    for (const from of Object.values(CognitiveState)) {
      expect(isForward(from, CognitiveState.ARCHIVED)).toBe(false)
    }
  })

  it('is false for moves down the ladder', () => {
    expect(
      isForward(CognitiveState.INTERNALIZED, CognitiveState.RETRIEVED),
    ).toBe(false)
  })
})
