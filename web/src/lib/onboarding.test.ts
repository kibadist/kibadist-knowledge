import { describe, expect, it } from 'vitest'

import type { OnboardingStep, OnboardingStepKey } from '@/lib/api'
import {
  nextOnboardingStep,
  ONBOARDING_STEP_COPY,
  onboardingProgress,
  onboardingStepHref,
} from './onboarding'

const KEYS: OnboardingStepKey[] = [
  'read',
  'predict',
  'approve',
  'earn',
  'map',
  'review',
]

function steps(
  done: Partial<Record<OnboardingStepKey, boolean>>,
): OnboardingStep[] {
  return KEYS.map((key) => ({ key, done: Boolean(done[key]) }))
}

describe('ONBOARDING_STEP_COPY', () => {
  it('has title/why/cta copy for every step key', () => {
    for (const key of KEYS) {
      const copy = ONBOARDING_STEP_COPY[key]
      expect(copy.title.length).toBeGreaterThan(0)
      expect(copy.why.length).toBeGreaterThan(0)
      expect(copy.cta.length).toBeGreaterThan(0)
    }
  })
})

describe('onboardingStepHref', () => {
  it('anchors article steps to the starter article with the right reading mode', () => {
    expect(onboardingStepHref('read', 'art1')).toBe(
      '/transformer/articles/art1',
    )
    expect(onboardingStepHref('predict', 'art1')).toBe(
      '/transformer/articles/art1?mode=predict',
    )
    expect(onboardingStepHref('approve', 'art1')).toBe(
      '/transformer/articles/art1?mode=extract',
    )
    expect(onboardingStepHref('review', 'art1')).toBe(
      '/transformer/articles/art1?mode=review',
    )
  })

  it('routes earn to Read and map to the graph regardless of article id', () => {
    expect(onboardingStepHref('earn', 'art1')).toBe('/inbox')
    expect(onboardingStepHref('map', null)).toBe('/graph')
  })

  it('never produces a dead link before the starter is seeded', () => {
    expect(onboardingStepHref('predict', null)).toBe('/today')
  })
})

describe('onboardingProgress', () => {
  it('is all-zero for no steps (no divide-by-zero)', () => {
    expect(onboardingProgress([])).toEqual({ done: 0, total: 0, pct: 0 })
  })

  it('counts done steps and rounds the percentage', () => {
    // 2 of 6 done = 33.3 → 33
    expect(onboardingProgress(steps({ read: true, predict: true }))).toEqual({
      done: 2,
      total: 6,
      pct: 33,
    })
  })

  it('reaches 100% when every step is done', () => {
    const all = steps(
      Object.fromEntries(KEYS.map((k) => [k, true])) as Record<
        OnboardingStepKey,
        boolean
      >,
    )
    expect(onboardingProgress(all).pct).toBe(100)
  })
})

describe('nextOnboardingStep', () => {
  it('returns the first not-done step in order', () => {
    expect(nextOnboardingStep(steps({ read: true }))?.key).toBe('predict')
  })

  it('returns null once everything is done', () => {
    const all = steps(
      Object.fromEntries(KEYS.map((k) => [k, true])) as Record<
        OnboardingStepKey,
        boolean
      >,
    )
    expect(nextOnboardingStep(all)).toBeNull()
  })
})
