/**
 * First-run walkthrough step derivation (DET-307).
 *
 * The guided sequence is computed from OBSERVABLE data, never from a stored
 * checklist the client ticks off: a step is done when the system can prove it
 * happened (a learning event was logged, a concept reached the earned layer, a
 * review prompt entered the engine). Only steps that leave no data trail — viewing
 * the Map — fall back to an explicit `completedSteps` marker. Deriving keeps the
 * checklist honest and reload-safe: it always reflects what the user actually did,
 * even across devices, and can't drift from the underlying knowledge.
 *
 * This module is pure so the loop's logic is unit-testable without Nest, Prisma,
 * or the network — the service supplies the signals, this decides done/not-done.
 */

/** The walkthrough, in order. Display copy + deep-links live on the web. */
export const ONBOARDING_STEP_KEYS = [
  'read',
  'predict',
  'approve',
  'earn',
  'map',
  'review',
] as const

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number]

/** The observable signals each step is derived from, gathered by the service. */
export interface OnboardingSignals {
  /** Distinct `article_learning_event` types logged against the starter article. */
  eventTypes: ReadonlySet<string>
  /** Earned (PERMANENT) concepts in the active workspace — the gate's only output. */
  earnedConceptCount: number
  /** Approved review prompts for the starter article (the Retrieval Engine sink). */
  reviewPromptCount: number
  /** Steps the user explicitly marked that leave no data trail (e.g. `map`). */
  completedSteps: readonly string[]
}

export interface OnboardingStep {
  key: OnboardingStepKey
  done: boolean
}

/**
 * Decide each step's done-ness from the signals. Reading is satisfied by either a
 * revealed section or an overview view; review by either an approved-prompt event
 * or a persisted engine prompt (the event log and the engine are distinct stores,
 * DET-278 — either is sufficient proof).
 */
export function deriveOnboardingSteps(
  signals: OnboardingSignals,
): OnboardingStep[] {
  const { eventTypes, earnedConceptCount, reviewPromptCount, completedSteps } =
    signals
  const has = (type: string) => eventTypes.has(type)
  const marked = (key: OnboardingStepKey) => completedSteps.includes(key)

  const done: Record<OnboardingStepKey, boolean> = {
    read: has('section_revealed') || has('overview_viewed') || marked('read'),
    predict: has('prediction_submitted') || marked('predict'),
    approve: has('concept_candidate_approved') || marked('approve'),
    earn: earnedConceptCount > 0 || marked('earn'),
    map: marked('map'),
    review:
      reviewPromptCount > 0 ||
      has('review_prompt_approved') ||
      marked('review'),
  }

  return ONBOARDING_STEP_KEYS.map((key) => ({ key, done: done[key] }))
}

/** True once every step is done — the checklist is then retired forever. */
export function isOnboardingComplete(steps: OnboardingStep[]): boolean {
  return steps.length > 0 && steps.every((s) => s.done)
}
