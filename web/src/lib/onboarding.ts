// Pure presentation + derivation for the first-run walkthrough (DET-307). The
// server owns step done-ness (derived from real activity); this owns the editorial
// copy, the learning-science "why" lines (the DET-306 voice, at the moments of
// friction), the deep-link each step routes to, and the small progress maths — all
// kept out of the Today component so they're unit-testable without React.
import type { OnboardingStep, OnboardingStepKey } from '@/lib/api'

export interface OnboardingStepCopy {
  key: OnboardingStepKey
  /** Imperative one-liner — what to do. */
  title: string
  /** Why it works, in plain learning-science terms (DET-306). */
  why: string
  /** The link label that routes into the surface for this step. */
  cta: string
}

// Verbatim copy for each step, in walkthrough order. The keys/order mirror the
// server's ONBOARDING_STEP_KEYS.
export const ONBOARDING_STEP_COPY: Record<
  OnboardingStepKey,
  OnboardingStepCopy
> = {
  read: {
    key: 'read',
    title: 'Read one section in deep mode',
    why: 'Reading a single section closely beats skimming the whole page — attention is where memory begins.',
    cta: 'Open the article',
  },
  predict: {
    key: 'predict',
    title: 'Predict before you reveal',
    why: 'Guessing first — even wrongly — primes your memory to hold the answer. That’s the pretesting effect.',
    cta: 'Try a prediction',
  },
  approve: {
    key: 'approve',
    title: 'Approve a concept in your own words',
    why: 'You only understand an idea once you can restate it yourself — so a concept is validated by explaining, never copying.',
    cta: 'Extract a concept',
  },
  earn: {
    key: 'earn',
    title: 'Earn it through the gate',
    why: 'A quick proof of recall is what turns a highlight into knowledge you’ll actually keep.',
    cta: 'Earn the concept',
  },
  map: {
    key: 'map',
    title: 'See it appear on the Map',
    why: 'Knowledge sticks when it’s connected — the Map shows where this idea lives among the rest.',
    cta: 'View on Map',
  },
  review: {
    key: 'review',
    title: 'Approve its first review',
    why: 'Spaced review fights the forgetting curve. Approve one prompt and it comes back tomorrow, right on time.',
    cta: 'Schedule a review',
  },
}

/**
 * The deep-link a step routes to, with the relevant surface (and reading mode)
 * pre-selected. Article-anchored steps need the seeded starter article id; without
 * it (not seeded yet) they fall back to Today, so the link is never dead.
 */
export function onboardingStepHref(
  key: OnboardingStepKey,
  articleId: string | null,
): string {
  const article = (mode?: string) =>
    articleId
      ? `/transformer/articles/${articleId}${mode ? `?mode=${mode}` : ''}`
      : '/today'
  switch (key) {
    case 'read':
      return article()
    case 'predict':
      return article('predict')
    case 'approve':
      return article('extract')
    case 'review':
      return article('review')
    case 'earn':
      // The validated candidate lands in Read as a "to learn" concept; the gate
      // (promote) is reached from there.
      return '/inbox'
    case 'map':
      return '/graph'
  }
}

export interface OnboardingProgress {
  done: number
  total: number
  pct: number
}

/** How far through the walkthrough the user is. */
export function onboardingProgress(
  steps: OnboardingStep[],
): OnboardingProgress {
  const total = steps.length
  const done = steps.filter((s) => s.done).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return { done, total, pct }
}

/** The first not-yet-done step — what to nudge the user toward next. */
export function nextOnboardingStep(
  steps: OnboardingStep[],
): OnboardingStep | null {
  return steps.find((s) => !s.done) ?? null
}
