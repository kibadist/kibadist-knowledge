/**
 * Source kind detection + article-shape selection (DET-345).
 *
 * A DETERMINISTIC pre-generation diagnosis: before the article pipeline reshapes a
 * source it looks at WHAT the source is (its block types, heading density, speech
 * patterns, reference density, table/list ratio, paragraph-length distribution and
 * source metadata) and decides (a) the `SourceKind` and (b) which `ArticleShape`
 * the v3 generator should aim for. No LLM call — every input is observable from the
 * already-segmented blocks, so the diagnosis is reproducible and unit-testable.
 *
 * WHY a separate module (not folded into transformer.types.ts). transformer.types
 * already exports an `ArticleShape` — the v2 GENRE vocabulary
 * ('explainer' | 'argument' | 'procedure' | …) the reshaping plan derives from
 * block classifications. The v3 router's article shape is a DIFFERENT, coarser
 * vocabulary keyed off the source KIND ('lesson_article' | 'concept_explainer' | …).
 * To avoid clobbering the frozen v2 contract these v3 types live here and are named
 * to read unambiguously at the call site (`SourceArticleShape`).
 *
 * ROLLOUT (per the ticket's architecture note). Detection feeds the v3 router, it
 * does NOT replace v2 globally:
 *  - v2 remains the default fallback for every source.
 *  - v3 behaviour is enabled only behind a feature flag, and even then only for the
 *    two known-broken source kinds: `transcript_lesson` and `structured_web_article`.
 *  - The diagnosis itself is computed and stored for EVERY article (available to
 *    both pipelines and to analytics); only the ROUTING is gated.
 *  - `unknown` sources never route to v3 — they fall back to the conservative,
 *    source-grounded v2 article with no external enrichment.
 */

/** What kind of thing the source material is. */
export type SourceKind =
  | 'transcript_lesson'
  | 'structured_web_article'
  | 'research_paper'
  | 'raw_notes'
  | 'documentation'
  | 'unknown'

/**
 * The shape the v3 generator should aim for. Distinct from the v2 `ArticleShape`
 * in transformer.types.ts (see module note). `null` is the conservative
 * source-grounded fallback used for `unknown` sources — there is no bespoke shape,
 * the article is generated faithfully from the source with no enrichment.
 */
export type SourceArticleShape =
  | 'lesson_article'
  | 'concept_explainer'
  | 'research_digest'
  | 'technical_walkthrough'
  | 'reference_digest'
  | 'structured_notes'

/** Which generation pipeline the router selected for an article. */
export type ArticlePipeline = 'v2' | 'v3'

/**
 * Source metadata the detector may consult (a thin projection of the
 * TransformerSource row). All optional — a pasted-text source has none of it.
 */
export interface SourceDiagnosisMetadata {
  /** Ingestion type: pasted TEXT, a fetched URL, or an uploaded PDF. */
  sourceType?: 'TEXT' | 'URL' | 'PDF' | null
  /** The fetched URL (URL sources only). */
  url?: string | null
  /** The uploaded file name (PDF sources only). */
  fileName?: string | null
  /** PDF page count, when the extractor recovered it. */
  pageCount?: number | null
}

/**
 * The measurable signals the detector derives from the blocks + metadata. Exposed
 * on the diagnosis so the decision is inspectable (and asserted directly in tests).
 * Ratios are over the total block count and live in [0, 1].
 */
export interface DetectionSignals {
  totalBlocks: number
  /** Count of blocks per (lower-cased) block type, e.g. { paragraph: 4, code: 1 }. */
  blockTypeCounts: Record<string, number>
  /** headings / totalBlocks. */
  headingDensity: number
  /** (table + list) / totalBlocks. */
  tableListRatio: number
  /** code / totalBlocks. */
  codeRatio: number
  /** Density of reference/citation signals (citation blocks + inline markers). */
  referenceDensity: number
  /** Strength of transcript/speech patterns, in [0, 1]. */
  transcriptScore: number
  /** Mean word count across paragraph-like blocks. */
  avgParagraphWords: number
  /** Coefficient of variation (stdev / mean) of paragraph word counts. */
  paragraphLengthCv: number
  /** Fraction of paragraph-like blocks that are short fragments (< 12 words). */
  shortFragmentRatio: number
}

/** A per-kind detection score, kept for inspection + tie diagnostics. */
export type SourceKindScores = Record<Exclude<SourceKind, 'unknown'>, number>

/**
 * The full diagnosis stored on the article generation job. `confidence` is the
 * winning kind's score (0 for `unknown`); `rationale` is a short human-readable
 * trail of the signals that drove the decision.
 */
export interface SourceDiagnosis {
  sourceKind: SourceKind
  /** Selected v3 shape; `null` for the conservative source-grounded fallback. */
  articleShape: SourceArticleShape | null
  confidence: number
  signals: DetectionSignals
  scores: SourceKindScores
  rationale: string[]
}

/**
 * The router's decision: which pipeline runs + the diagnosis that drove it. v3 is
 * only ever returned when the feature flag is on AND the source kind is one of the
 * initially-targeted broken kinds; everything else is `v2`.
 */
export interface ArticleRoutingDecision {
  pipeline: ArticlePipeline
  diagnosis: SourceDiagnosis
  /** One-line, human-readable explanation of the routing choice (logged). */
  reason: string
  /**
   * Whether a FAILED v3 job may be re-run on v2 (DET-362). Carried from the
   * `ARTICLE_GENERATION_V3_FALLBACK_TO_V2` flag so the pipeline knows the failure
   * policy without re-reading config. Off by default — a v3 failure stays FAILED
   * unless this is explicitly enabled.
   */
  fallbackToV2OnFailure: boolean
}
