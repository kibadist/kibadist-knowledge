/**
 * Shared event-to-mode mapping (DET-278).
 *
 * Each learning mode emits a fixed set of `article_learning_events`. Pinning the
 * mapping here means a mode ticket can't invent an event type the log doesn't
 * accept, and downstream consumers (Concept Library candidates, the Retrieval
 * Engine) can reason about which mode produced an event.
 *
 * DET-280 Key-Term Overview  -> overview_viewed
 * DET-282 Predict Before Reveal -> prediction_submitted, section_revealed,
 *                                  comparison_generated
 * DET-285 Rewrite-the-Block   -> block_rewrite_started, rewrite_peeked,
 *                                block_rewrite_submitted
 * DET-286 Compare & Repair    -> comparison_generated, rewrite_revised
 * DET-287 Concept Extraction  -> concept_candidate_approved
 * DET-288 Spaced Review       -> review_prompt_approved, review_completed
 * DET-321 Inline Retrieval Prompts -> retrieval_prompt_attempted
 *
 * (DET-284 Deep Reading is the host reading surface; it owns no events of its own
 *  — it hosts the entry-points into the other modes.)
 */

import type { ArticleLearningEventType } from './article-learning.types'

export type LearningMode =
  | 'DET-280'
  | 'DET-282'
  | 'DET-285'
  | 'DET-286'
  | 'DET-287'
  | 'DET-288'
  | 'DET-321'

/** Canonical mode -> events mapping. Frozen so it is read-only at runtime. */
export const EVENTS_BY_MODE: Readonly<
  Record<LearningMode, readonly ArticleLearningEventType[]>
> = Object.freeze({
  'DET-280': ['overview_viewed'],
  'DET-282': [
    'prediction_submitted',
    'section_revealed',
    'comparison_generated',
  ],
  'DET-285': [
    'block_rewrite_started',
    'rewrite_peeked',
    'block_rewrite_submitted',
  ],
  'DET-286': ['comparison_generated', 'rewrite_revised'],
  'DET-287': ['concept_candidate_approved'],
  'DET-288': ['review_prompt_approved', 'review_completed'],
  'DET-321': ['retrieval_prompt_attempted'],
})

/** The events a given mode is allowed to emit. */
export function eventsForMode(
  mode: LearningMode,
): readonly ArticleLearningEventType[] {
  return EVENTS_BY_MODE[mode]
}

/**
 * Which modes can emit a given event. Some events (e.g. `comparison_generated`)
 * are shared across modes, so this returns an array.
 */
export function modesForEvent(event: ArticleLearningEventType): LearningMode[] {
  return (Object.keys(EVENTS_BY_MODE) as LearningMode[]).filter((mode) =>
    EVENTS_BY_MODE[mode].includes(event),
  )
}

/** Whether `mode` is permitted to emit `event`. */
export function isEventAllowedForMode(
  mode: LearningMode,
  event: ArticleLearningEventType,
): boolean {
  return EVENTS_BY_MODE[mode].includes(event)
}
