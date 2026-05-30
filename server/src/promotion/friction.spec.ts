import { FrictionLevel, GateMode } from '@kibadist/prisma'

import { modeForLevel, proposeFriction, requiredGates } from './friction'

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
