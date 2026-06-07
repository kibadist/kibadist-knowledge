import {
  deriveOnboardingSteps,
  isOnboardingComplete,
  ONBOARDING_STEP_KEYS,
  type OnboardingSignals,
} from './onboarding.steps'

function signals(over: Partial<OnboardingSignals> = {}): OnboardingSignals {
  return {
    eventTypes: new Set<string>(),
    earnedConceptCount: 0,
    reviewPromptCount: 0,
    completedSteps: [],
    ...over,
  }
}

function doneKeys(s: OnboardingSignals): string[] {
  return deriveOnboardingSteps(s)
    .filter((step) => step.done)
    .map((step) => step.key)
}

describe('deriveOnboardingSteps', () => {
  it('returns every step, in order, all undone for a fresh user', () => {
    const steps = deriveOnboardingSteps(signals())
    expect(steps.map((s) => s.key)).toEqual([...ONBOARDING_STEP_KEYS])
    expect(steps.every((s) => !s.done)).toBe(true)
  })

  it('marks read on either a revealed section or an overview view', () => {
    expect(
      doneKeys(signals({ eventTypes: new Set(['section_revealed']) })),
    ).toContain('read')
    expect(
      doneKeys(signals({ eventTypes: new Set(['overview_viewed']) })),
    ).toContain('read')
  })

  it('marks predict and approve from their learning events', () => {
    const done = doneKeys(
      signals({
        eventTypes: new Set([
          'prediction_submitted',
          'concept_candidate_approved',
        ]),
      }),
    )
    expect(done).toEqual(expect.arrayContaining(['predict', 'approve']))
  })

  it('marks earn only once a concept reaches the earned layer', () => {
    expect(doneKeys(signals({ earnedConceptCount: 0 }))).not.toContain('earn')
    expect(doneKeys(signals({ earnedConceptCount: 1 }))).toContain('earn')
  })

  it('marks review from a persisted engine prompt or the approval event', () => {
    expect(doneKeys(signals({ reviewPromptCount: 1 }))).toContain('review')
    expect(
      doneKeys(signals({ eventTypes: new Set(['review_prompt_approved']) })),
    ).toContain('review')
  })

  it('marks map only from an explicit completedSteps entry (no data trail)', () => {
    expect(doneKeys(signals())).not.toContain('map')
    expect(doneKeys(signals({ completedSteps: ['map'] }))).toContain('map')
  })

  it('lets completedSteps cover any step as a manual override', () => {
    const done = doneKeys(signals({ completedSteps: ['read', 'predict'] }))
    expect(done).toEqual(expect.arrayContaining(['read', 'predict']))
  })
})

describe('isOnboardingComplete', () => {
  it('is false until every step is done', () => {
    expect(isOnboardingComplete(deriveOnboardingSteps(signals()))).toBe(false)
    expect(
      isOnboardingComplete(
        deriveOnboardingSteps(
          signals({
            eventTypes: new Set([
              'section_revealed',
              'prediction_submitted',
              'concept_candidate_approved',
              'review_prompt_approved',
            ]),
            earnedConceptCount: 1,
            // `map` still missing.
          }),
        ),
      ),
    ).toBe(false)
  })

  it('is true once all six steps are satisfied', () => {
    const steps = deriveOnboardingSteps(
      signals({
        eventTypes: new Set([
          'section_revealed',
          'prediction_submitted',
          'concept_candidate_approved',
          'review_prompt_approved',
        ]),
        earnedConceptCount: 1,
        completedSteps: ['map'],
      }),
    )
    expect(isOnboardingComplete(steps)).toBe(true)
  })
})
