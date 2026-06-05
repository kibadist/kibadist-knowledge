/**
 * Spaced Review prompts — shared contract (DET-288, under DET-278).
 *
 * Spaced Review is the mode that turns a one-time article into a recurring memory
 * object: after the learner predicts, rewrites, compares, or extracts concepts,
 * the system proposes future review prompts built from *their own* explanations
 * and validated concepts, and (only on approval) hands them to the Retrieval
 * Engine.
 *
 * This module is the CANONICAL, EXECUTABLE form of the DET-288 contract that the
 * web mode (`web/src/lib/spaced-review.ts`) mirrors. It pins three things so the
 * mode and any future server generator agree:
 *
 *   1. The review-prompt vocabulary — `ReviewPromptType` and the four UX groups
 *      (recall / misconception repair / contrast / transfer-application).
 *   2. The `ReviewPrompt` record shape (DET-288 "Data requirements"), with its
 *      stable identity and provenance fields.
 *   3. How a prompt type maps onto the existing scheduling contract
 *      (`prompt-scheduling.ts`): its risk class and the default review-prompt
 *      status, so "AI may propose review; the user validates what gets scheduled"
 *      (DET-278 §4) is enforced from one place.
 *
 * It also builds the two `article_learning_events` DET-288 owns —
 * `review_prompt_approved` and `review_completed` — with the metadata shape the
 * downstream Retrieval Engine and misconception profile read.
 *
 * Like its sibling contract files this module is PURE: no I/O, no scheduling
 * side-effects. It decides shapes and statuses; it never writes a row.
 *
 * IDs are written `snake_case` to match the wire/JSON contract (the deliberate
 * exception noted in `article-learning.types.ts`).
 */

import type {
  ArticleLearningEvent,
  ReviewPromptStatus,
} from './article-learning.types'
import {
  decidePromptScheduling,
  type PromptOrigin,
  type PromptRiskClass,
  type PromptSchedulingInput,
} from './prompt-scheduling'

// ---------------------------------------------------------------------------
// Review-prompt vocabulary.
// ---------------------------------------------------------------------------

/**
 * The kind of retrieval a prompt exercises (DET-288 "Prompt types"). Each maps to
 * a risk class and a UX group below.
 *
 *   - `definition_recall`       — "Explain X in your own words." (user-authored)
 *   - `source_faithful_recall`  — "What was the section's main claim about X?"
 *   - `misconception_repair`    — "Why is this interpretation wrong/incomplete?"
 *   - `contrast`                — "How is X different from Y?"
 *   - `transfer`                — "Where would X appear in a new situation?"
 *   - `metaphor_guardrail`      — "Where does this metaphor break?" (Living Concepts)
 */
export type ReviewPromptType =
  | 'definition_recall'
  | 'source_faithful_recall'
  | 'misconception_repair'
  | 'contrast'
  | 'transfer'
  | 'metaphor_guardrail'

/** All review-prompt types as a runtime array (DET-288 order). */
export const REVIEW_PROMPT_TYPES: readonly ReviewPromptType[] = [
  'definition_recall',
  'source_faithful_recall',
  'misconception_repair',
  'contrast',
  'transfer',
  'metaphor_guardrail',
]

/**
 * The UX grouping the prompts are shown under (DET-288 "Prompts are grouped by
 * type"). Several prompt types collapse into one display group.
 */
export type ReviewPromptGroup =
  | 'recall'
  | 'misconception'
  | 'contrast'
  | 'transfer'

/** All review-prompt groups as a runtime array (display order). */
export const REVIEW_PROMPT_GROUPS: readonly ReviewPromptGroup[] = [
  'recall',
  'misconception',
  'contrast',
  'transfer',
]

/** Which display group a prompt type belongs to. */
const GROUP_BY_TYPE: Readonly<Record<ReviewPromptType, ReviewPromptGroup>> = {
  definition_recall: 'recall',
  source_faithful_recall: 'recall',
  misconception_repair: 'misconception',
  contrast: 'contrast',
  transfer: 'transfer',
  // A metaphor guardrail is an application/transfer-flavoured check.
  metaphor_guardrail: 'transfer',
}

/** The display group a prompt type belongs to (DET-288 grouping). */
export function promptTypeGroup(type: ReviewPromptType): ReviewPromptGroup {
  return GROUP_BY_TYPE[type]
}

/**
 * The cognitive demand of each prompt type, in the scheduling contract's terms
 * (`prompt-scheduling.ts`). Only `low_risk_recall` is ever auto-schedulable —
 * recall is the only low-risk class; everything that asks the learner to
 * interpret, contrast, or transfer is gated behind explicit approval.
 */
const RISK_BY_TYPE: Readonly<Record<ReviewPromptType, PromptRiskClass>> = {
  definition_recall: 'low_risk_recall',
  source_faithful_recall: 'low_risk_recall',
  misconception_repair: 'interpretation',
  contrast: 'interpretation',
  transfer: 'transfer',
  metaphor_guardrail: 'transfer',
}

/** The scheduling risk class of a prompt type. */
export function promptTypeRiskClass(type: ReviewPromptType): PromptRiskClass {
  return RISK_BY_TYPE[type]
}

// ---------------------------------------------------------------------------
// The review-prompt record (DET-288 "Data requirements").
// ---------------------------------------------------------------------------

/**
 * A single generated review prompt. It is a SUGGESTION until the learner acts on
 * it: it only reaches the Retrieval Engine after approval (DET-278 §4). The
 * identity and provenance fields are what let a later review link back to the
 * article section, the originating learning event, and the concept (DET-288 AC
 * "Later review sessions link back…").
 */
export interface ReviewPrompt {
  prompt_id: string
  article_id: string
  article_version_id?: string
  section_id?: string
  concept_id?: string
  /** Original source spans backing the prompt, when grounded. */
  source_span_ids: string[]
  /** The `article_learning_events` row this prompt was derived from, if any. */
  created_from_event_id?: string
  prompt_type: ReviewPromptType
  /** Where the prompt's content originates — the dominant scheduling gate (§4). */
  origin: PromptOrigin
  /** The question shown to the learner. */
  question: string
  /**
   * A short summary of the expected answer. For user-authored prompts this is
   * grounded in the learner's own words; for source-faithful prompts, in the
   * article/source. Never the learner's verbatim text dressed up as AI output.
   */
  expected_answer_summary: string
  status: ReviewPromptStatus
  /** Retrieval Engine schedule hints; empty until the engine schedules it. */
  schedule_metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Default status — wire the prompt into the scheduling rule (DET-278 §4).
// ---------------------------------------------------------------------------

/** The facts a prompt carries that the scheduling rule switches on. */
export interface ReviewPromptSchedulingFacts {
  /** Whether the user has enabled auto-scheduling in product settings. */
  autoScheduleEnabled?: boolean
  /** Whether the user clicked a bulk-approval CTA for this batch. */
  bulkApprovalClicked?: boolean
}

/**
 * The status a freshly generated prompt should take. Per DET-288's "AI-generated
 * prompts are not scheduled without user approval" the MVP default is
 * `suggested`; a prompt is only born `scheduled` when the full strict
 * auto-schedule conjunction of `decidePromptScheduling` holds — which, because
 * only `low_risk_recall` types qualify and user consent is required, never fires
 * by default. Returns the resolved status; the prompt's `origin`, `prompt_type`,
 * source backing, and confidence drive the decision.
 */
export function defaultReviewPromptStatus(
  prompt: Pick<ReviewPrompt, 'origin' | 'prompt_type' | 'source_span_ids'> & {
    hasUserAuthoredExplanation: boolean
    sourceConfidence: PromptSchedulingInput['sourceConfidence']
  },
  facts: ReviewPromptSchedulingFacts = {},
): ReviewPromptStatus {
  const decision = decidePromptScheduling({
    origin: prompt.origin,
    riskClass: promptTypeRiskClass(prompt.prompt_type),
    hasSourceSpan: prompt.source_span_ids.length > 0,
    hasUserAuthoredExplanation: prompt.hasUserAuthoredExplanation,
    sourceConfidence: prompt.sourceConfidence,
    autoScheduleEnabled: facts.autoScheduleEnabled ?? false,
    bulkApprovalClicked: facts.bulkApprovalClicked ?? false,
  })
  return decision.status
}

// ---------------------------------------------------------------------------
// Event builders — the two events DET-288 owns.
// ---------------------------------------------------------------------------

/** The fields an event builder needs from the caller (the rest is stamped). */
type EventDraft = Omit<ArticleLearningEvent, 'id' | 'created_at' | 'updated_at'>

/**
 * Build the `review_prompt_approved` event for an approved prompt (DET-288 event
 * storage rules). The learner's edited question rides in `prompt`; the metadata
 * carries the identity needed to reconcile the prompt with the Retrieval Engine.
 */
export function buildReviewPromptApprovedEvent(args: {
  user_id: string
  prompt: ReviewPrompt
  /** The schedule the Retrieval Engine assigned, when already scheduled. */
  schedule_id?: string
}): EventDraft {
  const { user_id, prompt, schedule_id } = args
  return {
    user_id,
    article_id: prompt.article_id,
    article_version_id: prompt.article_version_id,
    section_id: prompt.section_id,
    source_span_ids: prompt.source_span_ids,
    event_type: 'review_prompt_approved',
    prompt: prompt.question,
    metadata: {
      prompt_id: prompt.prompt_id,
      prompt_type: prompt.prompt_type,
      prompt_group: promptTypeGroup(prompt.prompt_type),
      concept_id: prompt.concept_id,
      created_from_event_id: prompt.created_from_event_id,
      origin: prompt.origin,
      schedule_id,
    },
  }
}

/**
 * Build the `review_completed` event recorded when a later review session is
 * finished (DET-288 event storage rules). The learner's answer, when captured,
 * is stored verbatim in `user_answer`; the originating prompt and schedule are
 * referenced in metadata so the outcome links back to the article and concept.
 */
export function buildReviewCompletedEvent(args: {
  user_id: string
  prompt: ReviewPrompt
  /** The schedule the Retrieval Engine ran this review under. */
  schedule_id?: string
  /** The learner's answer for this review, stored verbatim when present. */
  user_answer?: string
  /** Block the review was anchored to, when narrower than the section. */
  block_id?: string
}): EventDraft {
  const { user_id, prompt, schedule_id, user_answer, block_id } = args
  return {
    user_id,
    article_id: prompt.article_id,
    article_version_id: prompt.article_version_id,
    section_id: prompt.section_id,
    block_id,
    source_span_ids: prompt.source_span_ids,
    event_type: 'review_completed',
    user_answer,
    metadata: {
      prompt_id: prompt.prompt_id,
      prompt_type: prompt.prompt_type,
      concept_id: prompt.concept_id,
      schedule_id,
    },
  }
}

// ---------------------------------------------------------------------------
// Display labels (stable vocabulary; UI copy lives in the web mode).
// ---------------------------------------------------------------------------

/** A neutral, human label for each prompt type. */
export const REVIEW_PROMPT_TYPE_LABEL: Record<ReviewPromptType, string> = {
  definition_recall: 'Definition recall',
  source_faithful_recall: 'Source-faithful recall',
  misconception_repair: 'Misconception repair',
  contrast: 'Contrast',
  transfer: 'Transfer',
  metaphor_guardrail: 'Metaphor guardrail',
}

/** A neutral, human label for each display group. */
export const REVIEW_PROMPT_GROUP_LABEL: Record<ReviewPromptGroup, string> = {
  recall: 'Recall',
  misconception: 'Misconception repair',
  contrast: 'Contrast',
  transfer: 'Transfer & application',
}
