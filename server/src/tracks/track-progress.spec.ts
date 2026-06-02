import { CognitiveState, RequiredDepth } from '@kibadist/prisma'

import { trackConceptProgress } from './track-progress'

describe('trackConceptProgress', () => {
  it('marks EXPLAIN met once the concept is EXPLAINED', () => {
    const p = trackConceptProgress(
      RequiredDepth.EXPLAIN,
      CognitiveState.EXPLAINED,
    )
    expect(p.met).toBe(true)
    expect(p.ratio).toBe(1)
  })

  it('marks TEACH unmet at EXPLAINED but met at DEFENDED (the ticket ladder)', () => {
    const below = trackConceptProgress(
      RequiredDepth.TEACH,
      CognitiveState.EXPLAINED,
    )
    const at = trackConceptProgress(
      RequiredDepth.TEACH,
      CognitiveState.DEFENDED,
    )
    const beyond = trackConceptProgress(
      RequiredDepth.TEACH,
      CognitiveState.INTERNALIZED,
    )
    expect(below.met).toBe(false)
    expect(below.ratio).toBeCloseTo(2 / 5)
    expect(at.met).toBe(true)
    expect(beyond.met).toBe(true)
  })

  it('treats the SAME state differently per required depth (per-track demand)', () => {
    // A RETRIEVED concept teaches APPLY but not TEACH.
    const apply = trackConceptProgress(
      RequiredDepth.APPLY,
      CognitiveState.RETRIEVED,
    )
    const teach = trackConceptProgress(
      RequiredDepth.TEACH,
      CognitiveState.RETRIEVED,
    )
    expect(apply.met).toBe(true)
    expect(teach.met).toBe(false)
  })

  it('flags DORMANT/CONTESTED as needing attention and not meeting deep demand', () => {
    const dormant = trackConceptProgress(
      RequiredDepth.APPLY,
      CognitiveState.DORMANT,
    )
    const contested = trackConceptProgress(
      RequiredDepth.TEACH,
      CognitiveState.CONTESTED,
    )
    expect(dormant.met).toBe(false)
    expect(dormant.needsAttention).toBe(true)
    expect(contested.needsAttention).toBe(true)
  })

  it('RECOGNIZE is met by a PARSED concept', () => {
    expect(
      trackConceptProgress(RequiredDepth.RECOGNIZE, CognitiveState.PARSED).met,
    ).toBe(true)
    expect(
      trackConceptProgress(RequiredDepth.RECOGNIZE, CognitiveState.SEEN).met,
    ).toBe(false)
  })
})
