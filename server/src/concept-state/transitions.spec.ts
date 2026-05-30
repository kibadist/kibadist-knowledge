import { CognitiveState } from '@kibadist/prisma'

import { ALLOWED_TRANSITIONS, canTransition } from './transitions'

describe('canTransition', () => {
  it('allows representative legal moves', () => {
    expect(canTransition(CognitiveState.SEEN, CognitiveState.PARSED)).toBe(true)
    expect(canTransition(CognitiveState.PARSED, CognitiveState.EXPLAINED)).toBe(
      true,
    )
    expect(canTransition(CognitiveState.EXPLAINED, CognitiveState.LINKED)).toBe(
      true,
    )
    expect(canTransition(CognitiveState.LINKED, CognitiveState.RETRIEVED)).toBe(
      true,
    )
    expect(
      canTransition(CognitiveState.RETRIEVED, CognitiveState.INTERNALIZED),
    ).toBe(true)
    expect(
      canTransition(CognitiveState.DORMANT, CognitiveState.RETRIEVED),
    ).toBe(true)
    expect(canTransition(CognitiveState.CONTESTED, CognitiveState.LINKED)).toBe(
      true,
    )
  })

  it('allows archiving from every non-terminal state', () => {
    for (const from of Object.values(CognitiveState)) {
      if (from === CognitiveState.ARCHIVED) continue
      expect(canTransition(from, CognitiveState.ARCHIVED)).toBe(true)
    }
  })

  it('rejects illegal moves', () => {
    // ARCHIVED is terminal.
    for (const to of Object.values(CognitiveState)) {
      expect(canTransition(CognitiveState.ARCHIVED, to)).toBe(false)
    }
    // No skipping the lifecycle.
    expect(
      canTransition(CognitiveState.SEEN, CognitiveState.INTERNALIZED),
    ).toBe(false)
    // EXPLAINED cannot jump straight to DEFENDED (must be LINKED/RETRIEVED first).
    expect(
      canTransition(CognitiveState.EXPLAINED, CognitiveState.DEFENDED),
    ).toBe(false)
  })
})

describe('ALLOWED_TRANSITIONS', () => {
  it('is total — every CognitiveState has an entry', () => {
    for (const state of Object.values(CognitiveState)) {
      expect(ALLOWED_TRANSITIONS[state]).toBeDefined()
    }
  })
})
