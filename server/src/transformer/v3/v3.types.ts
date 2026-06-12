/**
 * Source-Grounded Learning Article Engine — Article JSON v3 contract (DET-343).
 *
 * WHY v3 exists. v2 (`ArticleJsonV2`) reshapes a source into a faithful, typed,
 * fully-traceable article — but it is SOURCE-PRESERVING first and learning-aware
 * only as a bolt-on (the learning layer is a separate on-demand artifact). The PRD
 * asks for the inverse: an article that is LEARNING-FIRST and source-GROUNDED — it
 * preserves source meaning, exposes the concepts/claims a learner must acquire,
 * ships retrieval prompts, records provenance, and is BLOCKED when it would teach
 * something the source never said.
 *
 * STRANGLER PATTERN. v3 is a NEW pipeline beside v2, never an in-place rewrite.
 * v2 stays frozen (critical fixes only). v3 owns its own persistence columns
 * (`articleJsonV3` / `qualityReport` / `pipelineVersion`) so the v2 read boundary
 * never branches on a v3 document. A feature flag + source-kind routing decide
 * which engine runs (see `v3-routing.util.ts`); v3 is default-off until the
 * regression fixtures meet the quality gates.
 *
 * THE INVARIANT (inherited from v2, sharpened). Every claim a learner reads is
 * either GROUNDED in named source blocks or VISIBLY marked as AI scaffolding —
 * `provenance` is mandatory on every block and every claim. The quality gate
 * (`quality-gate.util.ts`) refuses READY_FOR_REVIEW while any unsupported claim
 * survives. v3 widens the article's PURPOSE (learning), never licenses the AI to
 * invent source meaning.
 */

import type { FidelityRisk } from '../transformer.types'

/** v3 article schema discriminator. Absence ⇒ a v1/v2 article. */
export const ARTICLE_SCHEMA_VERSION_V3 = 'v3' as const
export type ArticleSchemaVersionV3 = typeof ARTICLE_SCHEMA_VERSION_V3

/**
 * What KIND of source this is — detected up front (`source-kind.util.ts`) because
 * it drives article shape, the coverage threshold the gate enforces, and the
 * rewrite prompt. The PRD's two failing examples are a `transcript` (Udemy lesson)
 * and a `structured_article` (systems write-up).
 *  - `transcript`     — spoken/lesson material: filler, repetition, no headings.
 *  - `structured_article` — prose with headings/sections (a typical web article).
 *  - `reference`      — definitional/encyclopedic or API/spec material.
 *  - `mixed`          — no single signal dominates (the conservative default).
 */
export type SourceKind =
  | 'transcript'
  | 'structured_article'
  | 'reference'
  | 'mixed'

/**
 * The learning SHAPE the article is rendered as — chosen from the source kind +
 * its concept density. A transcript becomes a `lesson`; a concept-dense article
 * becomes a `concept_explainer`; a how-to becomes a `procedure`; a survey becomes
 * an `overview`.
 */
export type ArticleShapeV3 =
  | 'lesson'
  | 'concept_explainer'
  | 'procedure'
  | 'overview'
  | 'reference_entry'

/**
 * Provenance of a rendered fragment — the heart of "AI scaffolding is visibly
 * distinct from source-grounded claims" (acceptance criterion). `source` text is
 * a faithful rewrite of named blocks; `scaffold` text is AI connective tissue
 * (transitions, framing, learning prompts) the source never contained and the UI
 * marks "✦ AI · not from your source".
 */
export type Provenance = 'source' | 'scaffold'

/** Fields every v3 article block carries. */
export interface ArticleBlockV3 {
  id: string
  type: 'paragraph' | 'list' | 'callout' | 'example' | 'definition'
  text: string
  /** Non-empty for `provenance: 'source'`; MAY be empty only for scaffold. */
  sourceBlockIds: string[]
  provenance: Provenance
  /** Risk that the rewrite drifted from the source meaning (mirrors v2). */
  fidelityRisk: FidelityRisk
  /** Ordered list items, present only for `type: 'list'`. */
  items?: string[]
}

/** A v3 section: a learning beat with a heading and source-grounded blocks. */
export interface ArticleSectionV3 {
  id: string
  heading: string
  /** Whether the heading text is lifted from the source or AI-synthesized. */
  headingProvenance: Provenance
  sourceBlockIds: string[]
  blocks: ArticleBlockV3[]
}

/**
 * One step in the article's learning path — what the learner should be able to do
 * after the matching section. Scaffolding by nature (the source rarely states its
 * own objectives), so always `provenance: 'scaffold'`, but anchored to the real
 * sections it draws on.
 */
export interface LearningPathStep {
  id: string
  /** A learning objective, phrased as a capability ("Explain why …"). */
  objective: string
  /** Section ids this objective is taught by. */
  sectionIds: string[]
}

/**
 * A concept the learner must acquire — the v3 "key concept". A source-grounded
 * proposal (never an earned library Concept): it carries the verbatim blocks that
 * define it so the proof-of-learning entry point and the promotion gate can use
 * its provenance. `aiAssisted` is always true (the AI surfaced it).
 */
export interface KeyConcept {
  id: string
  label: string
  definition: string
  sourceBlockIds: string[]
  aiAssisted: true
}

/**
 * A key claim the source makes — extracted so the learner can be tested on it and
 * so the gate can audit support. `support` is the crux of the unsupported-claim
 * gate: `grounded` claims cite real blocks; `unsupported` claims are assertions
 * the article makes that NO source block backs (the gate blocks the article while
 * any survive).
 */
export interface KeyClaim {
  id: string
  text: string
  sourceBlockIds: string[]
  support: 'grounded' | 'unsupported'
}

/** A retrieval-practice prompt — a question whose answer the source supports. */
export interface RetrievalPromptV3 {
  id: string
  prompt: string
  /** The blocks whose content answers the prompt (non-empty: it must be testable). */
  sourceBlockIds: string[]
}

/**
 * A source note — a faithful, neutral observation ABOUT the source the learner
 * should keep in mind (a caveat the source raised, a scope limit, a definition the
 * source assumes). Always grounded; never an AI opinion.
 */
export interface SourceNote {
  id: string
  text: string
  sourceBlockIds: string[]
}

/** The learning layer baked into a v3 article (not a separate on-demand artifact). */
export interface LearningLayerV3 {
  learningPath: LearningPathStep[]
  keyConcepts: KeyConcept[]
  keyClaims: KeyClaim[]
  retrievalPrompts: RetrievalPromptV3[]
  sourceNotes: SourceNote[]
}

/**
 * A compact provenance summary stamped onto the article so the renderer (and the
 * gate) can reason about grounding without re-walking every block: how much of the
 * rendered article is source-grounded vs scaffold.
 */
export interface ProvenanceSummary {
  totalBlocks: number
  sourceGroundedBlocks: number
  scaffoldBlocks: number
  /** sourceGroundedBlocks / totalBlocks, 0–100 (100 when there are no blocks). */
  groundedPercent: number
}

/**
 * Article JSON v3 — the structured, learning-first, source-grounded document.
 * Discriminated on `schemaVersion: 'v3'`. Self-contained: the learning layer and
 * provenance live INSIDE it (unlike v2, where they are separate columns/artifacts).
 */
export interface ArticleJsonV3 {
  schemaVersion: ArticleSchemaVersionV3
  sourceKind: SourceKind
  shape: ArticleShapeV3
  title: { text: string; provenance: Provenance }
  /** A short learning-first lede: what the learner will get. Usually scaffold. */
  summary: { text: string; provenance: Provenance }
  sections: ArticleSectionV3[]
  learning: LearningLayerV3
  provenance: ProvenanceSummary
}

// --- Quality gate verdict (DET-343) ----------------------------------------
//
// The gate's verdict is stored in its own `qualityReport` column (not in
// articleJsonV3) and ALSO drives the row's TransformedArticleStatus. It is kept
// as JSON (with this richer v3 status) so no enum migration is needed; the
// pipeline maps `V3ArticleStatus` onto the existing TransformedArticleStatus.

/**
 * The v3 article's learning-quality status — richer than the row enum:
 *  - `READY_FOR_REVIEW` — passed every gate; a human can review/publish it.
 *  - `BLOCKED`          — a hard gate failed (unsupported claims, coverage floor)
 *     and regeneration is unlikely to help without source/pipeline changes.
 *  - `NEEDS_REGENERATION` — a gate failed but the blockers are addressable by a
 *     targeted regeneration pass (`regeneration.util.ts`).
 *  - `FAILED`           — could not produce a schema-valid article at all.
 */
export type V3ArticleStatus =
  | 'READY_FOR_REVIEW'
  | 'BLOCKED'
  | 'NEEDS_REGENERATION'
  | 'FAILED'

/** A machine-readable reason an article did not reach READY_FOR_REVIEW. */
export type BlockerCode =
  | 'IMPORTANT_COVERAGE_BELOW_THRESHOLD'
  | 'UNSUPPORTED_CLAIMS_PRESENT'
  | 'NO_CONCEPT_CANDIDATES'
  | 'NO_RETRIEVAL_PROMPTS'
  | 'LOW_EXERCISE_READINESS'

/** One blocker, with enough context for the UI and the regeneration planner. */
export interface QualityBlocker {
  code: BlockerCode
  /** 'hard' blockers ⇒ BLOCKED/NEEDS_REGENERATION; 'soft' ⇒ advisory only. */
  severity: 'hard' | 'soft'
  message: string
  /** Section/block/claim ids the blocker points at (drives targeted regen). */
  refs: string[]
}

/**
 * The v3 quality-gate report — the deterministic audit the gate produces from a
 * generated article. Mirrors v2's coverage/fidelity reports but is LEARNING-aware
 * and is what the acceptance criteria are written against.
 */
export interface QualityReport {
  status: V3ArticleStatus
  sourceKind: SourceKind
  /** % of IMPORTANT source blocks represented (substance, not noise). */
  importantCoveragePercent: number
  /** The threshold applied for this source kind (transcript 80, structured 70). */
  importantCoverageThreshold: number
  /** Raw count of claims whose support is `unsupported` (must be 0 to pass). */
  unsupportedClaimCount: number
  conceptCandidateCount: number
  retrievalPromptCount: number
  /** A 0–100 readiness score for turning the article into exercises. */
  exerciseReadiness: number
  groundedPercent: number
  blockers: QualityBlocker[]
}
