import { CognitiveState, GateMode } from '@kibadist/prisma'

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
    mode: GateMode.QUICK,
    ...over,
  }
}

describe('evaluateGates', () => {
  it('passes all four gates for a linked QUICK promotion', () => {
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

  it('allows a deliberate root in QUICK mode (EXPLAINED state)', () => {
    const out = evaluateGates(
      state(),
      decision({ isRoot: true, connectionsReviewed: true }),
    )
    expect(out.connect).toBe(true)
    expect(out.cognitiveState).toBe(CognitiveState.EXPLAINED)
    expect(out.ready).toBe(true)
  })

  it('rejects a bare root in DEEP mode — must be placed in the graph', () => {
    const out = evaluateGates(
      state(),
      decision({
        isRoot: true,
        connectionsReviewed: true,
        mode: GateMode.DEEP,
      }),
    )
    expect(out.connect).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('accepts a linked DEEP promotion', () => {
    const out = evaluateGates(
      state(),
      decision({
        connectionCount: 2,
        connectionsReviewed: true,
        mode: GateMode.DEEP,
      }),
    )
    expect(out.ready).toBe(true)
    expect(out.cognitiveState).toBe(CognitiveState.LINKED)
  })

  it('fails articulate on missing or too-short text', () => {
    expect(
      evaluateGates(
        state({ articulation: null }),
        decision({ connectionCount: 1, connectionsReviewed: true }),
      ).articulate,
    ).toBe(false)
    expect(
      evaluateGates(
        state({ articulation: '   short   ' }),
        decision({ connectionCount: 1, connectionsReviewed: true }),
      ).articulate,
    ).toBe(false)
  })

  it('fails articulate when the text is a verbatim copy of the source (DET-190)', () => {
    const out = evaluateGates(
      // Long enough text, but flagged as not the user's own words.
      state({ articulationIsOriginal: false }),
      decision({ connectionCount: 1, connectionsReviewed: true }),
    )
    expect(out.articulate).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('fails retrieve until the graded recall passes', () => {
    const out = evaluateGates(
      state({ retrievalPassed: false }),
      decision({ connectionCount: 1, connectionsReviewed: true }),
    )
    expect(out.retrieve).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('fails validate if AI connections were never reviewed', () => {
    const out = evaluateGates(
      state(),
      decision({ connectionCount: 1, connectionsReviewed: false }),
    )
    expect(out.validate).toBe(false)
    expect(out.ready).toBe(false)
  })

  it('fails connect with no link and no root', () => {
    const out = evaluateGates(state(), decision({ connectionsReviewed: true }))
    expect(out.connect).toBe(false)
    expect(out.ready).toBe(false)
  })
})
