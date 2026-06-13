/**
 * Source-grounded editorial rewrite — shared v3 contracts (DET-349, EPIC DET-343).
 *
 * The "Source-Grounded Learning Article Engine" (DET-343) is a NEW v3 pipeline
 * built in PARALLEL to the live v2 transformer (it never rewrites v2 in place).
 * Its stages are split across sibling tickets:
 *   DET-345 → SourceKind + (learning) article shape detection
 *   DET-346 → per-block SourceBlockRole classification
 *   DET-347 → conceptual segmentation → ordered SourceSegment[]
 *   DET-348 → learning-first LearningOutline from those segments
 *   DET-349 → THIS stage: rewrite each approved outline section into prose
 *   DET-344 → the canonical, full ArticleJsonV3 contract that subsumes all of these
 *
 * Those tickets are still in review and NOT merged here, so this file defines the
 * PROVISIONAL inputs the rewrite stage consumes (`SourceSegment`, `LearningOutline`)
 * and the outputs it produces (`ArticleSectionV3` and friends). When DET-344 lands
 * it owns the canonical shapes; the names/fields here are deliberately aligned with
 * the ticket prose so that re-pointing the imports is a mechanical change.
 *
 * INVARIANT (inherited from the v2 engine): every generated fragment is traceable
 * to real source blocks. Every paragraph carries a `SourceTrace`; every callout and
 * table carries `sourceBlockIds`. The rewrite SERVICE re-checks every cited id in
 * code against the segment block universe — the LLM is untrusted.
 */

/**
 * What kind of source the article was generated from (DET-345). Drives how
 * aggressively the rewrite may reshape: a spoken `transcript_lesson` needs speech
 * cleanup and a learning arc imposed; a `structured_web_article` needs its layout
 * reorganized into a learning flow rather than copied.
 */
export type SourceKind =
  | 'transcript_lesson'
  | 'structured_web_article'
  | 'research_paper'
  | 'raw_notes'
  | 'documentation'
  | 'unknown'

/**
 * The learning-first shape the outline chose for the article (DET-345/DET-348).
 * Distinct from the v2 `ArticleShape` (presentation genre) — this is the teaching
 * structure. Provisional pending DET-345's canonical enum.
 */
export type LearningArticleShape =
  | 'lesson_flow'
  | 'concept_explainer'
  | 'reference_entry'
  | 'argument'
  | 'procedure'
  | 'narrative'
  | 'hybrid'

/**
 * The teaching role a source block plays (DET-346). The rewrite stage uses it to
 * gate transformations — e.g. only a block whose role is `analogy` may become a
 * `source_analogy` callout, so an AI-invented analogy can never be grounded.
 */
export type SourceBlockRole =
  | 'core_claim'
  | 'definition'
  | 'example'
  | 'analogy'
  | 'caveat'
  | 'transition'
  | 'instructor_aside'
  | 'background'
  | 'reference'
  | 'navigation'
  | 'unknown'

/** One classified source block as it travels through the v3 pipeline. */
export interface SegmentBlock {
  id: string
  role: SourceBlockRole
  text: string
}

/**
 * A conceptual segment (DET-347): an ordered group of classified blocks that share
 * one coherent teaching idea. The rewrite stage rewrites a segment's blocks into
 * prose; the segment's block ids are the ONLY ids a section grounded on it may cite.
 */
export interface SourceSegment {
  id: string
  /** A short, source-grounded gist of what the segment covers (optional). */
  summary?: string
  blocks: SegmentBlock[]
}

/**
 * One section of the learning outline (DET-348). Headings are learning-first
 * (inferred from content), never a copy of the source layout. `segmentIds` point at
 * the segments whose blocks this section must be rewritten from. One level of
 * nesting is allowed (`subsections`).
 */
export interface OutlineSection {
  id: string
  heading: string
  headingSource: HeadingSourceV3
  /** Segments (by id) this section is grounded in, in reading order. */
  segmentIds: string[]
  /** Optional one-line learning intent for the section (guides the rewrite). */
  intent?: string
  subsections?: OutlineSection[]
}

/** The approved learning outline the rewrite stage consumes (DET-348). */
export interface LearningOutline {
  title: string
  sourceKind: SourceKind
  shape: LearningArticleShape
  sections: OutlineSection[]
}

/** Heading provenance in v3 (mirrors v2 `HeadingSourceV2`). */
export type HeadingSourceV3 = 'original' | 'cleanedOriginal' | 'inferred'

export type FidelityRisk = 'low' | 'medium' | 'high'

/**
 * How a paragraph was derived from its source blocks (DET-349). Ordered from most
 * to least faithful:
 *  - `verbatim` — the source text, unchanged.
 *  - `grammar_cleanup` — punctuation/typo/casing fixes only.
 *  - `speech_cleanup` — removed transcript filler/false-starts; meaning unchanged.
 *  - `source_grounded_rewrite` — reworded for clarity; every claim still in source.
 *  - `source_grounded_summary` — condensed multiple source blocks faithfully.
 *  - `source_grounded_inference` — a connection the source supports but does not
 *    state verbatim (highest-risk grounded transform).
 *  - `ai_assisted_scaffold` — connective/editorial framing text; only kept when it
 *    still cites a real block, and always carries high fidelity risk.
 */
export type RewriteTransformationType =
  | 'verbatim'
  | 'grammar_cleanup'
  | 'speech_cleanup'
  | 'source_grounded_rewrite'
  | 'source_grounded_summary'
  | 'source_grounded_inference'
  | 'ai_assisted_scaffold'

/**
 * The provenance every generated paragraph carries (DET-349, ticket contract).
 * `confidence` is a 0–1 self-assessment, clamped in code.
 */
export interface SourceTrace {
  sourceBlockIds: string[]
  transformationType: RewriteTransformationType
  fidelityRisk: FidelityRisk
  confidence: number
}

/** A prose paragraph with its full source trace. */
export interface ArticleParagraphV3 {
  id: string
  text: string
  trace: SourceTrace
}

/**
 * Source-grounded callout types (DET-350). `source_analogy` is special: it may ONLY
 * be produced from a source block whose role is `analogy` — an AI-invented analogy
 * is never emitted in default mode.
 */
export type ArticleCalloutType =
  | 'definition'
  | 'key_idea'
  | 'source_analogy'
  | 'caveat'
  | 'example'
  | 'warning'
  | 'remember'
  | 'compare'

/** A source-grounded callout box rendered beside a section. */
export interface ArticleCalloutV3 {
  id: string
  calloutType: ArticleCalloutType
  title?: string
  text: string
  sourceBlockIds: string[]
  fidelityRisk: FidelityRisk
}

/** A source-grounded comparison/data table. */
export interface ArticleTableV3 {
  id: string
  caption?: string
  header?: string[]
  rows: string[][]
  sourceBlockIds: string[]
  fidelityRisk: FidelityRisk
}

/**
 * A fully rewritten article section (DET-349 output). Carries prose paragraphs and
 * optional source-grounded callouts/tables, plus one level of `subsections`. Every
 * paragraph is traceable; the section's own `sourceBlockIds` is the union of its
 * paragraph/callout/table provenance (computed in code).
 */
export interface ArticleSectionV3 {
  id: string
  heading: string
  headingSource: HeadingSourceV3
  sourceBlockIds: string[]
  paragraphs: ArticleParagraphV3[]
  callouts?: ArticleCalloutV3[]
  tables?: ArticleTableV3[]
  subsections?: ArticleSectionV3[]
}
