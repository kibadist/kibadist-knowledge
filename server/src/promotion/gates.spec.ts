import { CognitiveState, FrictionLevel } from '@kibadist/prisma'

import { evaluateGates, type GateState, MIN_ARTICULATION_CHARS } from './gates'

const GOOD_ARTICULATION = 'x'.repeat(MIN_ARTICULATION_CHARS)

/** A passing Gate 1/3 state; override per case. Original by default (DET-190). */
function state(over: Partial<GateState> = {}): GateState {
  return {
    articulation: GOOD_ARTICULATION,
    articulationIsOriginal: true,
    retrievalPassed: true,
    ...over,
  }
}

function decision(over: Partial<Parameters<typeof evaluateGates>[1]> = {}) {
  return {
    connectionCount: 0,
    isRoot: false,
    connectionsReviewed: false,
    level: FrictionLevel.DEEP,
    ...over,
  }
}

describe('evaluateGates — friction-scaled requirements (DET-197)', () => {
  it('DEEP requires the full gate; a linked, reviewed, recalled concept passes', () => {
    const out = evaluateGates(
      state(),
      decision({ connectionCount: 1, connectionsReviewed: true }),
    )
    expect(out).toEqual({
      articulate: true,
      connect: true,
      retrieve: true,
      validate: true,
      ready: true,
      cognitiveState: CognitiveState.LINKED,
    })
  })

  it('MINIMAL promotes on compression alone — no link, recall, or review needed', () => {
    const out = evaluateGates(
      // No link, no recall pass, no review.
      state({ retrievalPassed: false }),
      decision({ level: FrictionLevel.MINIMAL }),
    )
    expect(out.connect).toBe(true) // not required → satisfied
    expect(out.retrieve).toBe(true)
    expect(out.validate).toBe(true)
    expect(out.ready).toBe(true)
    expect(out.cognitiveState).toBe(CognitiveState.EXPLAINED)
  })

  it('MINIMAL still fails when the compression is missing or a verbatim copy', () => {
    expect(
      evaluateGates(
        state({ articulation: null }),
        decision({ level: FrictionLevel.MINIMAL }),
      ).ready,
    ).toBe(false)
    expect(
      evaluateGates(
        state({ articulationIsOriginal: false }),
        decision({ level: FrictionLevel.MINIMAL }),
      ).ready,
    ).toBe(false)
  })

  it('LIGHT requires a connection but not recall/review', () => {
    const noLink = evaluateGates(
      state({ retrievalPassed: false }),
      decision({ level: FrictionLevel.LIGHT }),
    )
    expect(noLink.connect).toBe(false)
    expect(noLink.ready).toBe(false)

    const linked = evaluateGates(
      state({ retrievalPassed: false }),
      decision({ level: FrictionLevel.LIGHT, connectionCount: 1 }),
    )
    expect(linked.connect).toBe(true)
    expect(linked.retrieve).toBe(true) // not required at LIGHT
    expect(linked.validate).toBe(true)
    expect(linked.ready).toBe(true)
    expect(linked.cognitiveState).toBe(CognitiveState.LINKED)
  })

  it('DEEP needs a real link (a bare root does not satisfy connect)', () => {
    const out = evaluateGates(
      state(),
      decision({ isRoot: true, connectionsReviewed: true }),
    )
    expect(out.connect).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('DEEP fails retrieve until the graded recall passes', () => {
    const out = evaluateGates(
      state({ retrievalPassed: false }),
      decision({ connectionCount: 1, connectionsReviewed: true }),
    )
    expect(out.retrieve).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('DEEP fails validate until AI connections were reviewed', () => {
    const out = evaluateGates(
      state(),
      decision({ connectionCount: 1, connectionsReviewed: false }),
    )
    expect(out.validate).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('RIGOROUS requires the same gates as DEEP', () => {
    const out = evaluateGates(
      state(),
      decision({
        level: FrictionLevel.RIGOROUS,
        connectionCount: 1,
        connectionsReviewed: true,
      }),
    )
    expect(out.ready).toBe(true)
  })
})
