/**
 * Generated Article Learning Modes — shared contract (DET-278).
 *
 * This module is the CANONICAL, EXECUTABLE form of the coordination contract in
 * DET-278. Every learning-mode implementation ticket consumes these types and
 * the helpers next to them instead of re-deriving its own shapes:
 *
 *   - DET-284 Deep Reading        - DET-286 Compare & Repair
 *   - DET-280 Key-Term Overview   - DET-287 Concept Extraction
 *   - DET-282 Predict Before Reveal - DET-288 Spaced Review
 *   - DET-285 Rewrite-the-Block
 *
 * The contract exists because these modes share four things that MUST agree
 * across tickets or the data silently corrupts:
 *
 *   1. Stable IDs at three levels (article / section / block) — see
 *      `article-id.util.ts`. Learning events anchor to persisted ids, never to
 *      array indexes, so a re-render or re-extraction can't reattach a user's
 *      answer to the wrong block.
 *   2. A single `article_learning_events` log that is the source of truth for
 *      user activity — NOT the article JSON and NOT the Concept Library. See the
 *      `ArticleLearningEvent` shape below and the Prisma model of the same name.
 *   3. A prompt-scheduling rule that defaults to user approval — see
 *      `prompt-scheduling.ts`.
 *   4. A three-layer source-provenance model (user answer / generated article /
 *      original source) — see `source-provenance.ts`.
 *
 * The TS unions here are the single source of truth for the contract's
 * vocabularies. The Prisma enums (`ArticleLearningEventType`,
 * `ReviewPromptStatus`, `SourceConfidence`) MIRROR them member-for-member; a
 * test (`contract-sync.spec.ts`) fails if the two ever drift.
 *
 * IDs are written `snake_case` in this file to match the wire/JSON contract as
 * authored in DET-278 and the persisted Article JSON v2 column. This is the one
 * deliberate exception to the repo's camelCase convention — the JSON shape is a
 * cross-system contract, so it stays verbatim.
 */

// ---------------------------------------------------------------------------
// Article JSON v2 — the generated article a learning mode renders over.
// ---------------------------------------------------------------------------

/** Schema discriminator, so a stored article can be migrated if the shape
 *  evolves. Bump this (and mint a new `article_id`) on a material regeneration. */
export type ArticleSchemaVersion = 'article_json_v2'

/**
 * A block's structural kind. A superset of the source-document block types
 * (DET-210) — articles add `callout` and `divider` for generated scaffolding.
 */
export type ArticleBlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'quote'
  | 'table'
  | 'code'
  | 'callout'
  | 'image'
  | 'divider'

/**
 * A learning interaction a block supports. Advisory metadata the Reader uses to
 * decide which mode entry-points to offer on a block; never required for a mode
 * to function (a mode may operate on any eligible block).
 */
export type LearningAffordanceKind =
  | 'predict'
  | 'rewrite'
  | 'compare'
  | 'extract_concept'
  | 'review'

export interface LearningAffordance {
  kind: LearningAffordanceKind
  /** Optional human label for the entry-point chip. */
  label?: string
}

/** A key term surfaced for a section (powers DET-280 Key-Term Overview). */
export interface KeyTermRef {
  term: string
  /** Optional one-line gloss shown in the skeleton/overview. */
  gloss?: string
  /** Source spans backing the term, when the generator can cite them. */
  source_span_ids?: string[]
}

/**
 * A concept the section could yield (powers DET-287 Concept Extraction). This is
 * a SUGGESTION, never a promoted concept — promotion stays gated (DET-189).
 */
export interface ConceptCandidateRef {
  candidate_id: string
  label: string
  /** Source-grounded scaffold definition; never prefills the user's words. */
  definition?: string
  source_span_ids?: string[]
}

/**
 * A single article block. `content` is intentionally `unknown`: each block type
 * carries its own payload (paragraph runs, list items, table rows, …) and the
 * mode/Reader narrows it by `type`. The contract fixes the IDENTITY and
 * PROVENANCE fields; it does not freeze every block payload here.
 */
export interface ArticleBlockV2 {
  block_id: string
  section_id: string
  order_index: number
  type: ArticleBlockType
  content: unknown
  /** Original source spans this block is grounded in, when available. */
  source_span_ids?: string[]
  /** Source-document block ids (DET-210) this block was generated from. */
  generated_from_block_ids?: string[]
  learning_affordances?: LearningAffordance[]
}

export interface ArticleSectionV2 {
  section_id: string
  heading: string
  order_index: number
  key_terms?: KeyTermRef[]
  concept_candidates?: ConceptCandidateRef[]
  source_span_ids?: string[]
  blocks: ArticleBlockV2[]
}

export interface ArticleJsonV2 {
  article_id: string
  source_id: string
  schema_version: ArticleSchemaVersion
  title: string
  /** ISO-8601 timestamp the article version was generated. */
  generated_at: string
  sections: ArticleSectionV2[]
}

/**
 * The literal `schema_version` value. Exported so callers brand articles with
 * the constant instead of a stray string literal.
 */
export const ARTICLE_SCHEMA_VERSION: ArticleSchemaVersion = 'article_json_v2'

// ---------------------------------------------------------------------------
// Article learning events — the source-of-truth activity log.
// ---------------------------------------------------------------------------

/**
 * Every kind of recordable interaction across the learning modes. The mapping
 * from mode -> events lives in `event-mode-map.ts`; this union is the closed set
 * of event types the `article_learning_events` table accepts.
 */
export type ArticleLearningEventType =
  | 'overview_viewed'
  | 'prediction_submitted'
  | 'section_revealed'
  | 'block_rewrite_started'
  | 'block_rewrite_submitted'
  | 'rewrite_peeked'
  | 'comparison_generated'
  | 'rewrite_revised'
  | 'concept_candidate_approved'
  | 'review_prompt_approved'
  | 'review_completed'
  // DET-321: the learner attempted an inline retrieval prompt in the Article
  // tab (revealed the source passage behind it). Active reading, not earning.
  | 'retrieval_prompt_attempted'

/** All event types as a runtime array (ordered as authored in DET-278). */
export const ARTICLE_LEARNING_EVENT_TYPES: readonly ArticleLearningEventType[] =
  [
    'overview_viewed',
    'prediction_submitted',
    'section_revealed',
    'block_rewrite_started',
    'block_rewrite_submitted',
    'rewrite_peeked',
    'comparison_generated',
    'rewrite_revised',
    'concept_candidate_approved',
    'review_prompt_approved',
    'review_completed',
    'retrieval_prompt_attempted',
  ]

/**
 * One labelled feedback claim produced when AI compares a user's writing to the
 * article and (when available) the original source — used by DET-286 Compare &
 * Repair. Stored as STRUCTURED data, never only as prose, so later UIs can
 * filter/expand it and so provenance survives.
 */
export interface ArticleLearningFeedbackClaim {
  /** The category of the claim, e.g. what the comparison found. */
  kind:
    | 'preserved_from_article'
    | 'missing_from_article'
    | 'changed_meaning'
    | 'unsupported_by_source'
    | 'needs_source_check'
  /** Human-readable statement of the claim. */
  message: string
  /** How trustworthy the claim is, per the three-layer provenance model. */
  source_confidence: SourceConfidence
  /** Snapshot of the article block excerpt the claim is about, captured at
   *  feedback time so later article edits can't invalidate the record. */
  article_excerpt?: string
  /** Snapshot of the original source span excerpt, when available. */
  source_excerpt?: string
}

export interface ArticleLearningFeedback {
  claims: ArticleLearningFeedbackClaim[]
  /** Optional overall summary; never a substitute for the structured claims. */
  summary?: string
}

/**
 * A single row in the `article_learning_events` log. This is a USER ACTIVITY
 * record, not concept knowledge: it may or may not later seed a concept
 * candidate or a review prompt, but it is owned here and survives independently.
 *
 * Verbatim rule: `user_answer` is stored EXACTLY as the learner wrote it. AI
 * output goes in `ai_feedback` as structured data. Per-mode extras
 * (`peek_count`, focus duration, revision history, …) go in `metadata`.
 */
export interface ArticleLearningEvent {
  id: string
  user_id: string
  article_id: string
  /** The exact article version the event was created from, when versioned. */
  article_version_id?: string
  section_id?: string
  block_id?: string
  source_span_ids?: string[]

  event_type: ArticleLearningEventType

  /** AI-authored prompt/scaffold shown to the user (metadata, never the answer). */
  prompt?: string
  /** The learner's own words, stored verbatim. */
  user_answer?: string
  ai_feedback?: ArticleLearningFeedback
  metadata?: Record<string, unknown>

  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Review prompt scheduling vocabulary (rule #4; logic in prompt-scheduling.ts).
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a review prompt derived from a learning event. The MVP default is
 * `suggested`: AI may PROPOSE review, but the user validates what becomes
 * scheduled learning. `scheduled` is only reachable automatically when the
 * strict auto-schedule rule holds (see `canAutoSchedule`).
 */
export type ReviewPromptStatus =
  | 'suggested'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'retired'

/** All review-prompt statuses as a runtime array. */
export const REVIEW_PROMPT_STATUSES: readonly ReviewPromptStatus[] = [
  'suggested',
  'approved',
  'rejected',
  'scheduled',
  'retired',
]

// ---------------------------------------------------------------------------
// Source provenance vocabulary (rule #5; logic in source-provenance.ts).
// ---------------------------------------------------------------------------

/**
 * How trustworthy a claim is, deciding whether feedback can treat it as fact.
 * Generated article prose and the original source are NEVER collapsed into one
 * truth layer — `article_supported_source_unavailable` exists precisely to keep
 * "the article said so" distinct from "the source supports it".
 */
export type SourceConfidence =
  | 'source_supported'
  | 'article_supported_source_unavailable'
  | 'user_authored_unsourced'
  | 'unsupported_or_invented'
  | 'needs_review'

/** All source-confidence states as a runtime array. */
export const SOURCE_CONFIDENCE_STATES: readonly SourceConfidence[] = [
  'source_supported',
  'article_supported_source_unavailable',
  'user_authored_unsourced',
  'unsupported_or_invented',
  'needs_review',
]
