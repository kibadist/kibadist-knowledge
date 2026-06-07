import { FrictionLevel, GateMode, RequiredDepth } from '@kibadist/prisma'

import {
  FRICTION_RANK,
  modeForLevel,
  proposeFriction,
  requiredGates,
  trackPullForDepth,
} from './friction'

describe('proposeFriction', () => {
  it('drops a short, familiar, unflagged clip to MINIMAL', () => {
    const { level, reasons } = proposeFriction({
      novelty: 0.1,
      importance: false,
      sourceLength: 120,
    })
    expect(level).toBe(FrictionLevel.MINIMAL)
    expect(reasons.length).toBeGreaterThan(0)
  })

  it('proposes DEEP for genuinely novel material', () => {
    const { level, reasons } = proposeFriction({
      novelty: 0.8,
      importance: false,
      sourceLength: 800,
    })
    expect(level).toBe(FrictionLevel.DEEP)
    expect(reasons.join(' ')).toMatch(/new/i)
  })

  it('proposes DEEP when the user flags importance, even if familiar', () => {
    const { level, reasons } = proposeFriction({
      novelty: 0.1,
      importance: true,
      sourceLength: 800,
    })
    expect(level).toBe(FrictionLevel.DEEP)
    expect(reasons.join(' ')).toMatch(/important/i)
  })

  it('proposes LIGHT for routine, familiar-but-substantial-enough material', () => {
    const { level } = proposeFriction({
      novelty: 0.2,
      importance: false,
      sourceLength: 800,
    })
    expect(level).toBe(FrictionLevel.LIGHT)
  })

  it('escalates familiar-but-weighty material to DEEP', () => {
    const { level } = proposeFriction({
      novelty: 0.2,
      importance: false,
      sourceLength: 5000,
    })
    expect(level).toBe(FrictionLevel.DEEP)
  })

  it('never auto-proposes RIGOROUS (a deliberate user escalation only)', () => {
    for (const novelty of [0, 0.5, 1]) {
      for (const importance of [true, false]) {
        for (const sourceLength of [100, 1000, 9000]) {
          expect(
            proposeFriction({ novelty, importance, sourceLength }).level,
          ).not.toBe(FrictionLevel.RIGOROUS)
        }
      }
    }
  })

  // Gentler defaults (DET-311): a first-mile learner earns lightly.
  describe('first-mile learner (DET-311)', () => {
    it('stays LIGHT for novel, weighty, even importance-flagged material', () => {
      for (const importance of [true, false]) {
        const { level, reasons } = proposeFriction({
          novelty: 0.95,
          importance,
          sourceLength: 9000,
          isNewLearner: true,
        })
        expect(level).toBe(FrictionLevel.LIGHT)
        expect(reasons.join(' ')).toMatch(/lightly/i)
      }
    })

    it('an experienced learner still escalates the same material to DEEP', () => {
      const { level } = proposeFriction({
        novelty: 0.95,
        importance: false,
        sourceLength: 9000,
        isNewLearner: false,
      })
      expect(level).toBe(FrictionLevel.DEEP)
    })

    it('a track can still pull a first-mile learner above LIGHT, with a reason', () => {
      const { level, reasons } = proposeFriction({
        novelty: 0.1,
        importance: false,
        sourceLength: 100,
        isNewLearner: true,
        track: trackPullForDepth(
          'Understand transformers',
          RequiredDepth.APPLY,
        ),
      })
      expect(level).toBe(FrictionLevel.DEEP)
      expect(reasons.join(' ')).toMatch(/Understand transformers/)
    })
  })

  // Track-pulled depth (DET-311): depth is pulled by intent, not pushed.
  describe('track-pulled depth (DET-311)', () => {
    it('escalates to the track floor when it demands more than the baseline', () => {
      const { level, reasons } = proposeFriction({
        novelty: 0.1,
        importance: false,
        sourceLength: 800,
        track: trackPullForDepth('Exam prep', RequiredDepth.TEACH),
      })
      expect(level).toBe(FrictionLevel.DEEP)
      expect(reasons.join(' ')).toMatch(/Exam prep/)
    })

    it('does not lower a higher proposal toward a shallow track', () => {
      // Experienced + weighty material proposes DEEP; a RECOGNIZE track must not
      // pull it back down (the system never silently downgrades).
      const { level } = proposeFriction({
        novelty: 0.9,
        importance: false,
        sourceLength: 9000,
        track: trackPullForDepth('Skim list', RequiredDepth.RECOGNIZE),
      })
      expect(level).toBe(FrictionLevel.DEEP)
    })

    it('an EXPLAIN track does not escalate above the LIGHT baseline', () => {
      const { level } = proposeFriction({
        novelty: 0.1,
        importance: false,
        sourceLength: 800,
        isNewLearner: true,
        track: trackPullForDepth('Casual reading', RequiredDepth.EXPLAIN),
      })
      expect(level).toBe(FrictionLevel.LIGHT)
    })

    it('never pulls to RIGOROUS, even from the deepest track demand', () => {
      for (const depth of Object.values(RequiredDepth)) {
        const { level } = proposeFriction({
          novelty: 1,
          importance: true,
          sourceLength: 9000,
          track: trackPullForDepth('Any track', depth),
        })
        expect(level).not.toBe(FrictionLevel.RIGOROUS)
      }
    })
  })

  it('always gives a reason when the proposal is above LIGHT (DET-311)', () => {
    // Acceptance criterion: escalation reason is always shown above LIGHT.
    for (const isNewLearner of [true, false]) {
      for (const novelty of [0, 0.6, 1]) {
        for (const importance of [true, false]) {
          for (const sourceLength of [100, 2500]) {
            for (const depth of [
              null,
              RequiredDepth.APPLY,
              RequiredDepth.TEACH,
            ]) {
              const { level, reasons } = proposeFriction({
                novelty,
                importance,
                sourceLength,
                isNewLearner,
                track: depth ? trackPullForDepth('A track', depth) : null,
              })
              if (FRICTION_RANK[level] > FRICTION_RANK[FrictionLevel.LIGHT]) {
                expect(reasons.length).toBeGreaterThan(0)
              }
            }
          }
        }
      }
    }
  })
})

describe('requiredGates', () => {
  it('MINIMAL requires only articulate', () => {
    expect(requiredGates(FrictionLevel.MINIMAL)).toEqual({
      articulate: true,
      connect: false,
      retrieve: false,
      validate: false,
    })
  })

  it('LIGHT requires articulate + connect', () => {
    expect(requiredGates(FrictionLevel.LIGHT)).toEqual({
      articulate: true,
      connect: true,
      retrieve: false,
      validate: false,
    })
  })

  it('DEEP and RIGOROUS require the full gate', () => {
    const full = {
      articulate: true,
      connect: true,
      retrieve: true,
      validate: true,
    }
    expect(requiredGates(FrictionLevel.DEEP)).toEqual(full)
    expect(requiredGates(FrictionLevel.RIGOROUS)).toEqual(full)
  })
})

describe('modeForLevel', () => {
  it('maps DEEP/RIGOROUS to the higher retrieval bar', () => {
    expect(modeForLevel(FrictionLevel.DEEP)).toBe(GateMode.DEEP)
    expect(modeForLevel(FrictionLevel.RIGOROUS)).toBe(GateMode.DEEP)
  })
  it('maps MINIMAL/LIGHT to the routine bar', () => {
    expect(modeForLevel(FrictionLevel.MINIMAL)).toBe(GateMode.QUICK)
    expect(modeForLevel(FrictionLevel.LIGHT)).toBe(GateMode.QUICK)
  })
})
