import type { LearningLayer } from './api'

/**
 * Article learning-review contract (DET-359).
 *
 * NOTE (merge, DET-359 × DET-344): this layer was originally authored in
 * `article-v3.ts`, but `main` landed the *real* Article JSON v3 body contract at
 * that path (DET-344, the source-grounded article schema). The two are unrelated
 * — this one is the review/learning layer, that one is the article body — so it
 * was moved here to avoid the filename + symbol collision. Behaviour is
 * unchanged; only the module path moved.
 *
 * This adds a first-class *review* layer on top of the generated article: the
 * AI-suggested concept candidates and retrieval prompts a reader vets before any
 * of it becomes permanent knowledge. Like `article-v2.ts` (the DET-278
 * coordination contract), this is a client-side shape distinct from the api.ts
 * wire types; the article *body* still flows as Article JSON v2. The adapter
 * `learningLayerToReviewV3` bridges the existing server `LearningLayer` into this
 * shape so the review panels render from real data, defaulting the review-only
 * fields (importance, prompt type, linked concepts, expected-answer blocks,
 * review status) on rows generated before this lane.
 *
 * Two invariants are encoded structurally (DET-359 acceptance criteria):
 *  - A concept candidate's "accepted" status is a USER-REVIEW state. It never
 *    internalizes the concept into permanent knowledge — promotion stays a
 *    separate, explicit step. `isInternalized` is therefore always false here.
 *  - A retrieval prompt never becomes a permanent review card from this layer.
 *    Scheduling stays gated on explicit user validation or a user-authored
 *    answer; `promptAllowsScheduling` is the single gate the UI reads.
 */

export const ARTICLE_JSON_V3 = 'article_json_v3' as const

// --- Concept candidates ------------------------------------------------------

/** Importance the generator assigns a concept candidate (DET-359). */
export type ConceptImportance = 'high' | 'medium' | 'low'

/**
 * Review lifecycle of a concept candidate in the v3 reader (DET-359).
 *  - `pending`  — proposed, not yet reviewed.
 *  - `accepted` — moved to user-review state; NOT internalized as knowledge.
 *  - `rejected` — dismissed by the reader.
 *  - `deferred` — "create Living Concept later"; kept around, decided later.
 */
export type ConceptCandidateReviewStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'deferred'

export interface ConceptCandidateV3 {
  id: string
  label: string
  importance: ConceptImportance
  /** Source-backed short definition. */
  definition: string
  /** A short preview of the source span this candidate is grounded in. */
  sourceSpanPreview?: string
  /** The source blocks backing the candidate (non-empty when grounded). */
  sourceBlockIds: string[]
  /** The v2 section the candidate was extracted from, when known. */
  sectionId?: string
  status: ConceptCandidateReviewStatus
  /**
   * Set once acceptance created the user-review ("to learn") concept. Its
   * presence makes acceptance idempotent — never a second knowledge row.
   */
  conceptId?: string
}

// --- Retrieval prompts -------------------------------------------------------

/** The kind of recall a retrieval prompt exercises (DET-359, grouping key). */
export type RetrievalPromptType =
  | 'recall'
  | 'definition'
  | 'application'
  | 'comparison'
  | 'cause_effect'
  | 'synthesis'

/**
 * Review lifecycle of a retrieval prompt (DET-359).
 *  - `suggested` — AI-proposed, untouched.
 *  - `saved`     — kept as a suggestion. NOT scheduled (scheduling stays gated).
 *  - `answered`  — the reader authored an answer; this is the gate that lets a
 *                  prompt be scheduled downstream.
 *  - `rejected`  — dismissed.
 */
export type RetrievalPromptReviewStatus =
  | 'suggested'
  | 'saved'
  | 'answered'
  | 'rejected'

export interface RetrievalPromptV3 {
  id: string
  prompt: string
  type: RetrievalPromptType
  /** Concept candidates this prompt exercises (ids into `conceptCandidates`). */
  linkedConceptIds: string[]
  /** The source blocks that hold the expected answer. */
  expectedAnswerBlockIds: string[]
  status: RetrievalPromptReviewStatus
  /** The reader's own-words answer, stored verbatim. Gates scheduling. */
  userAnswer?: string
  /** All source blocks grounding the prompt (superset of expected-answer). */
  sourceBlockIds: string[]
}

/** The v3 review layer: candidates + prompts a reader vets before keeping. */
export interface ArticleLearningReviewV3 {
  schema_version: typeof ARTICLE_JSON_V3
  conceptCandidates: ConceptCandidateV3[]
  retrievalPrompts: RetrievalPromptV3[]
}

/**
 * Readiness of the article that backs the review surface. `blocked` is the
 * fidelity-gate hold (still reviewable, flagged); `generating`/`failed` have no
 * review layer yet; `unavailable` covers a missing/foreign article.
 */
export type ReviewArticleState =
  | 'ready'
  | 'blocked'
  | 'generating'
  | 'failed'
  | 'unavailable'

// --- Ordering + grouping helpers --------------------------------------------

/** High → low: the order importance buckets render in. */
export const IMPORTANCE_ORDER: readonly ConceptImportance[] = [
  'high',
  'medium',
  'low',
]

/** The order retrieval-prompt type groups render in (stable, generator-agnostic). */
export const RETRIEVAL_TYPE_ORDER: readonly RetrievalPromptType[] = [
  'recall',
  'definition',
  'application',
  'comparison',
  'cause_effect',
  'synthesis',
]

/** Human label for each importance bucket. */
export const IMPORTANCE_LABEL: Record<ConceptImportance, string> = {
  high: 'High importance',
  medium: 'Medium importance',
  low: 'Low importance',
}

/** Human label for each retrieval-prompt type. */
export const RETRIEVAL_TYPE_LABEL: Record<RetrievalPromptType, string> = {
  recall: 'Recall',
  definition: 'Definition',
  application: 'Application',
  comparison: 'Comparison',
  cause_effect: 'Cause & effect',
  synthesis: 'Synthesis',
}

/** A non-empty group of candidates sharing an importance bucket, in render order. */
export interface CandidateGroup {
  importance: ConceptImportance
  candidates: ConceptCandidateV3[]
}

/**
 * Group candidates by importance in High→Low order, preserving input order
 * within a bucket and omitting empty buckets. Pure — never mutates the input.
 */
export function groupCandidatesByImportance(
  candidates: ConceptCandidateV3[],
): CandidateGroup[] {
  return IMPORTANCE_ORDER.map((importance) => ({
    importance,
    candidates: candidates.filter((c) => c.importance === importance),
  })).filter((g) => g.candidates.length > 0)
}

/** A non-empty group of prompts sharing a type, in render order. */
export interface PromptGroup {
  type: RetrievalPromptType
  prompts: RetrievalPromptV3[]
}

/**
 * Group retrieval prompts by type in `RETRIEVAL_TYPE_ORDER`, preserving input
 * order within a group and omitting empty groups. Pure.
 */
export function groupPromptsByType(
  prompts: RetrievalPromptV3[],
): PromptGroup[] {
  return RETRIEVAL_TYPE_ORDER.map((type) => ({
    type,
    prompts: prompts.filter((p) => p.type === type),
  })).filter((g) => g.prompts.length > 0)
}

/**
 * The single scheduling gate (DET-359): a prompt may be scheduled as a permanent
 * review card ONLY when the reader authored an answer for it. "Saved as a
 * suggestion" deliberately does NOT qualify — saving keeps a proposal, it does
 * not validate it. This is the invariant the UI reads before offering to keep a
 * prompt as a review card; the scheduling itself lives downstream.
 */
export function promptAllowsScheduling(prompt: RetrievalPromptV3): boolean {
  return (
    prompt.status === 'answered' && (prompt.userAnswer?.trim().length ?? 0) > 0
  )
}

/**
 * Whether a candidate has been internalized into permanent knowledge. Always
 * false at this layer: accepting a candidate only moves it to a user-review
 * state, it never internalizes it (DET-359). Kept as a function so the invariant
 * is asserted in tests rather than assumed.
 */
export function isInternalized(_candidate: ConceptCandidateV3): boolean {
  return false
}

// --- Adapter -----------------------------------------------------------------

/** Map the server validation status onto the v3 candidate review status. */
function candidateStatusFromValidation(
  status: 'pending' | 'validated' | 'dismissed',
): ConceptCandidateReviewStatus {
  switch (status) {
    case 'validated':
      // Validation moves a candidate to the user-review ("to learn") inbox — a
      // review state, never internalized knowledge. That is exactly "accepted".
      return 'accepted'
    case 'dismissed':
      return 'rejected'
    default:
      return 'pending'
  }
}

/** Narrow an arbitrary string to a known importance, else `medium`. */
function coerceImportance(value: unknown): ConceptImportance {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium'
}

/** Narrow an arbitrary string to a known prompt type, else `recall`. */
function coercePromptType(value: unknown): RetrievalPromptType {
  return RETRIEVAL_TYPE_ORDER.includes(value as RetrievalPromptType)
    ? (value as RetrievalPromptType)
    : 'recall'
}

/** Narrow an arbitrary string to a known prompt review status, else `suggested`. */
function coercePromptStatus(value: unknown): RetrievalPromptReviewStatus {
  return value === 'saved' ||
    value === 'answered' ||
    value === 'rejected' ||
    value === 'suggested'
    ? value
    : 'suggested'
}

/**
 * Adapt the server `LearningLayer` into the v3 review shape (DET-359). The
 * v3-only fields default gracefully on legacy rows: importance → `medium`,
 * prompt type → `recall`, review status → `suggested`, expected-answer blocks →
 * the prompt's own source blocks. A null layer yields empty arrays so the panels
 * can render their empty states. Pure.
 */
export function learningLayerToReviewV3(
  layer: LearningLayer | null,
): ArticleLearningReviewV3 {
  const conceptCandidates: ConceptCandidateV3[] = (
    layer?.conceptCandidates ?? []
  ).map((c) => ({
    id: c.id,
    label: c.label,
    importance: coerceImportance(c.importance),
    definition: c.definition,
    sourceSpanPreview: c.sourceSpanPreview,
    sourceBlockIds: c.sourceBlockIds,
    sectionId: c.sectionId,
    status: candidateStatusFromValidation(c.validationStatus),
    conceptId: c.conceptId,
  }))

  const retrievalPrompts: RetrievalPromptV3[] = (
    layer?.retrievalPrompts ?? []
  ).map((p) => ({
    id: p.id,
    prompt: p.prompt,
    type: coercePromptType(p.promptType),
    linkedConceptIds: p.linkedConceptIds ?? [],
    expectedAnswerBlockIds: p.expectedAnswerBlockIds ?? p.sourceBlockIds,
    status: coercePromptStatus(p.reviewStatus),
    userAnswer: p.userAnswer,
    sourceBlockIds: p.sourceBlockIds,
  }))

  return {
    schema_version: ARTICLE_JSON_V3,
    conceptCandidates,
    retrievalPrompts,
  }
}
