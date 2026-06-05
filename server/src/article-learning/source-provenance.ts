/**
 * Source provenance resolution (DET-278, rule #5).
 *
 * Three layers, never collapsed:
 *   1. User answer       — what the learner wrote.
 *   2. Generated article — the learning scaffold they responded to.
 *   3. Original source   — the evidence basis, when available.
 *
 * Product rule: "Feedback should compare the learner to the article, but source
 * provenance should decide whether a claim is trustworthy." So a claim that
 * merely matches the generated article is NOT promoted to "source supported" —
 * `article_supported_source_unavailable` keeps "the article said so" distinct
 * from "the source backs it."
 *
 * This module is PURE: it maps the observable facts about a claim to a
 * `SourceConfidence`, and exposes the fixed UI label vocabulary. It never
 * fabricates certainty — when support can't be determined, it returns
 * `needs_review` rather than guessing.
 */

import type { SourceConfidence } from './article-learning.types'

/**
 * The observable facts about one feedback claim. These are deliberately the
 * minimal inputs the DET-278 feedback rules switch on.
 */
export interface ProvenanceInput {
  /** Could the model confidently determine the claim's support at all? When
   *  false, everything else is moot and the claim is `needs_review`. */
  determinable: boolean
  /** Does the user's writing preserve the article's meaning? */
  preservesArticleMeaning: boolean
  /** Does the article itself have original-source support? */
  articleHasSourceSupport: boolean
  /** Is the backing original source span actually available to cite? */
  sourceSpanAvailable: boolean
  /** Does the user add a claim that is in neither the article nor the source? */
  addsUnsupportedClaim: boolean
}

/**
 * Resolve the trust level of a feedback claim. Order matters: undeterminable and
 * invented claims short-circuit before the article/source matching rules.
 *
 * Mapping (DET-278 feedback rules):
 *   - not determinable                                -> needs_review
 *   - adds a claim absent from article AND source     -> unsupported_or_invented
 *   - preserves article meaning + article is sourced  -> source_supported
 *       (downgraded to article_supported_source_unavailable if the span itself
 *        isn't available to cite)
 *   - matches article prose but no source available   -> article_supported_source_unavailable
 *   - otherwise (user-authored, article-unmatched, not invented) -> user_authored_unsourced
 */
export function resolveSourceConfidence(
  input: ProvenanceInput,
): SourceConfidence {
  if (!input.determinable) {
    return 'needs_review'
  }

  if (input.addsUnsupportedClaim) {
    return 'unsupported_or_invented'
  }

  if (input.preservesArticleMeaning) {
    // The learner matched the article. Whether that is "source supported"
    // depends on the article having source backing AND that span being citable.
    if (input.articleHasSourceSupport && input.sourceSpanAvailable) {
      return 'source_supported'
    }
    return 'article_supported_source_unavailable'
  }

  // User-authored content that doesn't match the article and isn't invented:
  // it stands on the user's own authorship, unsourced.
  return 'user_authored_unsourced'
}

/**
 * The fixed feedback-claim categories shown in Compare & Repair Mode (DET-286).
 * UI copy lives elsewhere; this is the stable vocabulary the contract pins.
 */
export const FEEDBACK_CLAIM_KINDS = [
  'preserved_from_article',
  'missing_from_article',
  'changed_meaning',
  'unsupported_by_source',
  'needs_source_check',
] as const

export type FeedbackClaimKind = (typeof FEEDBACK_CLAIM_KINDS)[number]

/**
 * The explicit provenance LABELS the UI must use, so generated article prose and
 * the original source are never presented as one truth layer.
 */
export const PROVENANCE_LABELS = {
  userAnswer: 'Your rewrite',
  article: 'Article explanation',
  source: 'Original source',
  feedback: 'AI feedback',
} as const
