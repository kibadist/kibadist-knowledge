/**
 * Review-prompt scheduling decision (DET-278, rule #4).
 *
 * Product rule: "AI may propose review. The user validates what becomes scheduled
 * learning." So the MVP DEFAULT is `suggested` — a prompt is only auto-promoted
 * to `scheduled` when EVERY condition of the strict auto-schedule rule holds.
 *
 * A prompt may be auto-scheduled only if ALL are true:
 *   1. it is generated from user-authored text OR user-approved concept data;
 *   2. a source span is available, OR the user-authored explanation is stored;
 *   3. the prompt type is low-risk recall (not interpretation-heavy);
 *   4. the user has enabled auto-scheduling in settings OR clicked a bulk-approval
 *      CTA for this batch.
 *
 * Anything else — AI-prose-only prompts, inferred misconceptions, unconfirmed
 * concept relationships, transfer/application questions, Living-Concept metaphor
 * guardrails, low source-confidence — requires explicit user approval and stays
 * `suggested`.
 *
 * This module is PURE decision logic. It returns the status a prompt should take
 * and a machine-readable reason; it never writes anything.
 */

import type {
  ReviewPromptStatus,
  SourceConfidence,
} from './article-learning.types'

/**
 * Where the prompt's content originates. This is the dominant gate: only
 * user-authored or user-approved origins are ever eligible for auto-scheduling.
 */
export type PromptOrigin =
  /** Verbatim user-authored text (a rewrite, a typed explanation). */
  | 'user_authored_text'
  /** A corrected rewrite the user produced after feedback. */
  | 'corrected_rewrite'
  /** A concept candidate the user explicitly approved. */
  | 'approved_concept_candidate'
  /** A concept definition the user edited/authored. */
  | 'user_edited_concept'
  /** A claim missed in Compare & Repair, surfaced from user-vs-article diff. */
  | 'missed_claim'
  /** A claim grounded in an original source span. */
  | 'source_grounded_claim'
  /** Generated only from AI article prose — never auto-schedulable. */
  | 'ai_article_prose'
  /** An inferred misconception candidate — never auto-schedulable. */
  | 'inferred_misconception'
  /** A concept relationship the user has not confirmed — never auto-schedulable. */
  | 'unconfirmed_relationship'
  /** A transfer/application question beyond the source — never auto-schedulable. */
  | 'transfer_application'
  /** A Living-Concept metaphor guardrail prompt — never auto-schedulable. */
  | 'living_concept_metaphor'

/** Cognitive demand of the prompt. Only low-risk recall is auto-schedulable. */
export type PromptRiskClass = 'low_risk_recall' | 'interpretation' | 'transfer'

/** Origins that may carry a `suggested` prompt automatically (per rule #4). */
const SUGGESTIBLE_ORIGINS: readonly PromptOrigin[] = [
  'user_authored_text',
  'corrected_rewrite',
  'approved_concept_candidate',
  'user_edited_concept',
  'missed_claim',
  'source_grounded_claim',
  'inferred_misconception',
  'ai_article_prose',
]

/** Origins eligible for AUTOMATIC scheduling — the user-authored/approved set. */
const AUTO_ELIGIBLE_ORIGINS: readonly PromptOrigin[] = [
  'user_authored_text',
  'corrected_rewrite',
  'approved_concept_candidate',
  'user_edited_concept',
  'missed_claim',
  'source_grounded_claim',
]

export interface PromptSchedulingInput {
  origin: PromptOrigin
  riskClass: PromptRiskClass
  /** Whether an original source span backs the prompt. */
  hasSourceSpan: boolean
  /** Whether the user's own explanation is stored for the prompt. */
  hasUserAuthoredExplanation: boolean
  /** Confidence the model assigned to the underlying claim's support. */
  sourceConfidence: SourceConfidence
  /** Whether the user enabled auto-scheduling in product settings. */
  autoScheduleEnabled: boolean
  /** Whether the user clicked a bulk-approval CTA for this batch. */
  bulkApprovalClicked: boolean
}

export type SchedulingDecisionReason =
  | 'auto_schedule_rule_met'
  | 'origin_requires_approval'
  | 'risk_requires_approval'
  | 'no_source_or_explanation'
  | 'low_source_confidence'
  | 'user_consent_absent'

export interface SchedulingDecision {
  /** The status the prompt should be created with. */
  status: Extract<ReviewPromptStatus, 'suggested' | 'scheduled'>
  /** Whether automatic scheduling is permitted. */
  autoScheduled: boolean
  /** Machine-readable reason, for audit and UI messaging. */
  reason: SchedulingDecisionReason
}

/**
 * Decide whether a derived review prompt may be auto-scheduled, or must be
 * suggested for explicit approval. Returns `scheduled` only when the full
 * conjunction of rule #4 holds; otherwise `suggested` with the first failing
 * reason. Note that some origins are not even safe to SUGGEST automatically
 * (e.g. unconfirmed relationships, transfer questions, metaphor guardrails) —
 * `canSuggestAutomatically` reports that separately.
 */
export function decidePromptScheduling(
  input: PromptSchedulingInput,
): SchedulingDecision {
  // 1. Origin must be user-authored or user-approved.
  if (!AUTO_ELIGIBLE_ORIGINS.includes(input.origin)) {
    return {
      status: 'suggested',
      autoScheduled: false,
      reason: 'origin_requires_approval',
    }
  }

  // 2. Either a source span is available, or the user's explanation is stored.
  if (!input.hasSourceSpan && !input.hasUserAuthoredExplanation) {
    return {
      status: 'suggested',
      autoScheduled: false,
      reason: 'no_source_or_explanation',
    }
  }

  // 3. Prompt type must be low-risk recall, not interpretation/transfer.
  if (input.riskClass !== 'low_risk_recall') {
    return {
      status: 'suggested',
      autoScheduled: false,
      reason: 'risk_requires_approval',
    }
  }

  // Low source confidence always requires a human, even for eligible origins.
  if (
    input.sourceConfidence === 'unsupported_or_invented' ||
    input.sourceConfidence === 'needs_review'
  ) {
    return {
      status: 'suggested',
      autoScheduled: false,
      reason: 'low_source_confidence',
    }
  }

  // 4. The user must have consented, via settings or a bulk-approval CTA.
  if (!input.autoScheduleEnabled && !input.bulkApprovalClicked) {
    return {
      status: 'suggested',
      autoScheduled: false,
      reason: 'user_consent_absent',
    }
  }

  return {
    status: 'scheduled',
    autoScheduled: true,
    reason: 'auto_schedule_rule_met',
  }
}

/**
 * Whether the system may even SUGGEST a prompt from this origin without a human
 * first asking for it. The DET-278 "safe to suggest automatically" set. Origins
 * outside it (unconfirmed relationships, transfer/application, metaphor
 * guardrails) should only appear after explicit user action.
 */
export function canSuggestAutomatically(origin: PromptOrigin): boolean {
  return SUGGESTIBLE_ORIGINS.includes(origin)
}
