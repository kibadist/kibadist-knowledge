/**
 * Article JSON v3 — the Source-Grounded Learning Article contract (DET-344).
 *
 * WHY v3 exists. v2 (`ArticleJsonV2` in `transformer.types.ts`) models a
 * source-PRESERVING article: faithfully reshaped source prose with typed blocks
 * and traceability. v3 models a source-GROUNDED LEARNING article: the same
 * traceability invariant, but reorganised for LEARNING — a learning path, key
 * concepts/claims, terminology, misconception warnings, retrieval prompts and a
 * grounding-aware quality report — so the reader can actually study the material,
 * not just re-read it.
 *
 * PARALLEL, NOT A REWRITE (DET-344 architecture note). v3 lives BESIDE v2:
 *  - This file is self-contained; it does NOT re-export or extend the v2/v1
 *    `transformer.types.ts` shapes (only the stable primitive enums
 *    `TransformationType` / `FidelityRisk` / `Severity` are shared — those are
 *    not v2 article structure, just traceability vocabulary).
 *  - The discriminator is `schemaVersion: 'v3'` + `mode:
 *    'source_grounded_learning_article'`. v2 stays `'v2'` /
 *    `'source_preserving_article'` and keeps loading/rendering unchanged.
 *  - v3 generation is opt-in behind a feature flag (see `article-v3-flag.ts`);
 *    existing records are NEVER auto-migrated.
 *
 * THE INVARIANT (inherited from v1/v2). Every represented fragment is traceable
 * to the source. v3 carries that with a single `SourceTrace` primitive attached
 * to every content item — paragraphs, sections, claims, concepts, callouts,
 * tables and prompts. A trace may be `grounded: false` (the model's own
 * connective/learning scaffolding, e.g. a synthesised retrieval prompt), but
 * grounded traces MUST cite at least one real source block.
 */

import type {
  FidelityRisk,
  Severity,
  TransformationType,
} from './transformer.types'

/** v3 article schema-version discriminator. */
export const ARTICLE_V3_SCHEMA_VERSION = 'v3' as const
export type ArticleV3SchemaVersion = typeof ARTICLE_V3_SCHEMA_VERSION

/** v3 generation mode discriminator (distinct from v2's
 *  `source_preserving_article`). */
export const ARTICLE_V3_MODE = 'source_grounded_learning_article' as const
export type ArticleV3Mode = typeof ARTICLE_V3_MODE

/**
 * Which article schema version a generation job targets. The routing decision
 * (see `article-v3-flag.ts`) is `'v3'` only when the opt-in flag is on, `'v2'`
 * otherwise — so existing jobs keep producing the v2 contract by default.
 */
export type ArticleGenerationVersion = 'v2' | 'v3'

/**
 * What KIND of material the source was. Drives shape/genre heuristics and how the
 * learning layer is framed. Deliberately a closed set with an `other` escape so
 * the contract is stable but never blocks an unusual source.
 */
export type SourceKind =
  | 'article'
  | 'webpage'
  | 'pdf'
  | 'academic_paper'
  | 'book_excerpt'
  | 'documentation'
  | 'transcript'
  | 'lecture_notes'
  | 'plain_text'
  | 'other'

/**
 * Genre/shape of the article. Mirrors the v2 `ArticleShape` vocabulary
 * deliberately (re-declared, not imported, to keep v3 self-contained) so the two
 * pipelines can share shape heuristics without coupling their types.
 */
export type ArticleShape =
  | 'explainer'
  | 'argument'
  | 'procedure'
  | 'reference'
  | 'report'
  | 'narrative'
  | 'hybrid'

/** v3 heading provenance (matches the v2 `HeadingSourceV2` naming). */
export type HeadingSourceV3 = 'original' | 'cleanedOriginal' | 'inferred'

/**
 * Semantic role of a section / claim, derived from the source classification of
 * the cited blocks (never invented). Same vocabulary as v2 `SectionRole`.
 */
export type SectionRole =
  | 'definition'
  | 'claim'
  | 'evidence'
  | 'example'
  | 'step'
  | 'caveat'
  | 'background'
  | 'referenceEntry'
  | 'chronology'

/**
 * The traceability primitive carried by EVERY v3 content item. This is the v3
 * generalisation of v2's per-block `sourceBlockIds` + `transformationType` +
 * `fidelityRisk`.
 *
 *  - `grounded` — true when the item is lifted/derived from the source; false
 *    when it is the model's own learning scaffolding (e.g. a synthesised
 *    retrieval prompt or a connective transition). The schema REQUIRES a grounded
 *    trace to cite at least one real source block; an ungrounded trace may carry
 *    none.
 *  - `sourceBlockIds` — the cited source blocks (non-empty iff grounded).
 *  - `transformationType` — how the source text was transformed (verbatim →
 *    light_reword …); for ungrounded items this is conventionally `'light_reword'`
 *    or left to the producer — the schema does not constrain it by grounding.
 *  - `fidelityRisk` — the producer's self-assessed risk that the item drifts from
 *    source meaning. The fidelity checker re-derives this; never trusted.
 *  - `note` — optional human-readable provenance note (e.g. why an item is
 *    ungrounded).
 */
export interface SourceTrace {
  grounded: boolean
  sourceBlockIds: string[]
  transformationType: TransformationType
  fidelityRisk: FidelityRisk
  note?: string
}

/** The article title, with heading provenance and (optional) grounding trace. */
export interface ArticleTitle {
  text: string
  source: HeadingSourceV3
  sourceTrace?: SourceTrace
}

/** A prose paragraph. The v3 atom of body text. */
export interface ArticleParagraph {
  id: string
  text: string
  sourceTrace: SourceTrace
}

/** The block-type discriminator for an `ArticleBlock`. */
export type ArticleBlockType =
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'figure'

/** Fields every v3 section block carries. */
export interface ArticleBlockBase {
  id: string
  type: ArticleBlockType
  sourceTrace: SourceTrace
}

export interface ArticleParagraphBlock extends ArticleBlockBase {
  type: 'paragraph'
  text: string
}

export interface ArticleListBlock extends ArticleBlockBase {
  type: 'list'
  ordered: boolean
  items: string[]
}

export interface ArticleQuoteBlock extends ArticleBlockBase {
  type: 'quote'
  text: string
  attribution?: string
}

export interface ArticleCodeBlock extends ArticleBlockBase {
  type: 'code'
  text: string
  language?: string
}

/** An anchor where an illustration suggestion may be placed inline. */
export interface ArticleFigureBlock extends ArticleBlockBase {
  type: 'figure'
  suggestionId?: string
  caption?: string
}

/**
 * The inline body content of a section. Tables and callouts are NOT inline blocks
 * in v3: they are elevated to the top-level `tables` registry and
 * `calloutPlacements` map respectively (mirroring how v2 elevated
 * `calloutPlacements`), so the learning UI can index/quiz on them directly.
 */
export type ArticleBlock =
  | ArticleParagraphBlock
  | ArticleListBlock
  | ArticleQuoteBlock
  | ArticleCodeBlock
  | ArticleFigureBlock

/**
 * A v3 section: typed blocks, heading provenance, an optional learning summary,
 * an optional semantic role, and the concepts/claims it introduces (by id). One
 * level of nesting is allowed (`subsections`).
 */
export interface ArticleSection {
  id: string
  heading: string
  headingSource: HeadingSourceV3
  /** Blocks grounding the heading text (provenance for the inspector). */
  headingSourceBlockIds?: string[]
  /** A one-sentence, learner-facing summary of the section. */
  summary?: string
  sectionRole?: SectionRole
  sourceTrace: SourceTrace
  blocks: ArticleBlock[]
  /** Ids of `keyConcepts` this section introduces (cross-reference, not a copy). */
  conceptIds?: string[]
  /** Ids of `keyClaims` this section makes (cross-reference, not a copy). */
  claimIds?: string[]
  /** One level of nesting (H2 → H3). */
  subsections?: ArticleSection[]
}

/**
 * One step on the guided learning path through the article. The path is an
 * ORDERED reading/study plan: each item points at the section to read and the
 * concepts/claims it should leave the learner understanding.
 */
export interface LearningPathItem {
  id: string
  /** 0-based position in the path (also encodes order). */
  order: number
  /** Short imperative label, e.g. "Understand what spaced repetition is". */
  title: string
  /** What the learner should be able to do/explain after this step. */
  objective: string
  /** The section this step is anchored to (when it maps to one). */
  sectionId?: string
  /** Concepts this step teaches (ids into `keyConcepts`). */
  conceptIds: string[]
  /** Optional grounding for the step text (ungrounded ⇒ model-authored scaffold). */
  sourceTrace?: SourceTrace
}

/**
 * A candidate concept worth promoting to a real, learnable Concept. A CANDIDATE,
 * never an earned Concept — promotion is a separate gated flow. Grounded in the
 * blocks it was extracted from.
 */
export interface ConceptCandidate {
  id: string
  label: string
  definition: string
  /** Alternative surface forms / synonyms found in the source. */
  aliases?: string[]
  /** Section the concept was extracted from (cross-reference). */
  sectionId?: string
  /** Relative importance for ordering the concept list (0..1; producer-assigned). */
  importance?: number
  sourceTrace: SourceTrace
}

/**
 * A candidate claim the source makes. Surfaced so the learner can test their
 * understanding against the source's actual assertions.
 */
export interface ClaimCandidate {
  id: string
  /** The claim as a single declarative statement. */
  statement: string
  /** The kind of claim, grounding how it should be tested. */
  claimType?: 'fact' | 'opinion' | 'prediction' | 'definition' | 'causal'
  /** Section the claim is made in (cross-reference). */
  sectionId?: string
  sourceTrace: SourceTrace
}

/** A source term and its source-grounded definition. */
export interface TerminologyItem {
  id: string
  term: string
  definition: string
  sourceTrace: SourceTrace
}

/** A worked/illustrative example lifted from the source. */
export interface SourceExample {
  id: string
  text: string
  /** Optional caption/label for the example. */
  label?: string
  sectionId?: string
  sourceTrace: SourceTrace
}

/**
 * A misconception the source explicitly warns against (or that a learner is
 * likely to hold), paired with the source-grounded correction.
 */
export interface MisconceptionCandidate {
  id: string
  /** The mistaken belief, stated plainly. */
  misconception: string
  /** The source-grounded correction. */
  correction: string
  sectionId?: string
  sourceTrace: SourceTrace
}

/**
 * A retrieval-practice prompt (active recall). May be `grounded: false` in its
 * trace when the question is synthesised by the model, but its `answer`, when
 * present, must stay faithful to the source.
 */
export interface RetrievalPrompt {
  id: string
  /** The question posed to the learner. */
  prompt: string
  /** The source-grounded answer (optional — some prompts are open-ended). */
  answer?: string
  /** Concepts this prompt exercises (ids into `keyConcepts`). */
  conceptIds?: string[]
  sourceTrace: SourceTrace
}

/**
 * One placed inline callout (a key term / example / caveat re-surfaced beside the
 * section it relates to). REFERENCE-WITH-PLACEMENT, mirroring v2's `ArticleCallout`.
 */
export interface ArticleCallout {
  id: string
  kind: 'keyTerm' | 'example' | 'caveat' | 'misconception'
  /** Present for `keyTerm` callouts — the term being defined. */
  term?: string
  text: string
  /** Human-readable reason the callout was placed where it was. */
  placementReason: string
  sourceTrace: SourceTrace
}

/**
 * Where inline callouts were placed + what could not be placed. `bySection` maps
 * a section id to the callouts anchored beside it; `unplaced` holds items with no
 * confident section match.
 */
export interface CalloutPlacementMap {
  bySection: Record<string, ArticleCallout[]>
  unplaced: ArticleCallout[]
}

/**
 * A table elevated to the top-level registry. Carries its own id + trace so the
 * learning UI can index it; sections place it deterministically via `sectionId`.
 */
export interface ArticleTable {
  id: string
  caption?: string
  header?: string[]
  rows: string[][]
  /** Section the table belongs beside (placement). */
  sectionId?: string
  sourceTrace: SourceTrace
}

/**
 * An editorial note ABOUT the source/transformation (e.g. "the source omits a
 * definition for X", "two sections were merged"). Not article body content —
 * provenance/quality context for the reader and the inspector.
 */
export interface SourceNote {
  id: string
  kind: 'gap' | 'ambiguity' | 'structural' | 'editorial'
  text: string
  /** Optional grounding (a note about a specific block cites it). */
  sourceTrace?: SourceTrace
}

/** An external reference/citation the source itself makes. */
export interface SourceReference {
  id: string
  /** Display text of the citation. */
  citationText: string
  title?: string
  url?: string
  /** The block(s) where the source cited this reference. */
  sourceTrace?: SourceTrace
}

/** How the article was produced — generation metadata, never article substance. */
export interface ArticleProvenance {
  sourceKind: SourceKind
  /** The generation mode that produced this article. */
  generationMode: ArticleV3Mode
  /** The transformer source id (when known). */
  sourceId?: string
  /** Pinned blocks version the article was generated against. */
  blocksVersion?: number
  /** Model identifier that produced the article (e.g. "gpt-4o-mini"). */
  model?: string
  /** Monotonic pipeline contract version (bump on breaking generator changes). */
  pipelineVersion: number
  /** ISO-8601 timestamp; stamped in code, never prompt-trusted. */
  generatedAt?: string
}

/** One graded issue in the v3 quality report. */
export interface QualityIssue {
  severity: Severity
  /** Stable category so the UI/metrics can group issues. */
  category:
    | 'ungrounded_content'
    | 'lost_information'
    | 'added_information'
    | 'meaning_change'
    | 'low_concept_coverage'
    | 'weak_learning_path'
    | 'other'
  description: string
  /** The article item this issue is about (e.g. a section/paragraph id). */
  articleRef?: string
  sourceBlockIds?: string[]
}

/**
 * The v3 quality report. Distinct from v2's `FidelityReport`: it grades both
 * SOURCE FIDELITY (grounding/coverage) and LEARNING QUALITY (concept coverage,
 * path strength). `approved` is recomputed in code (never trusted from the LLM),
 * exactly as v2 recomputes its `approved`.
 */
export interface ArticleQualityReportV3 {
  /** 0..1 — fraction of body content that is grounded in the source. */
  groundingScore: number
  /** 0..1 — fraction of source blocks represented in the article. */
  coverageScore: number
  /** 0..1 — how well the key concepts cover the source's teachable material. */
  conceptCoverageScore: number
  /** Final gate, recomputed in code from the issues + scores. */
  approved: boolean
  issues: QualityIssue[]
}

/**
 * Article JSON v3 — the Source-Grounded Learning Article. Discriminated on
 * `schemaVersion: 'v3'` and `mode: 'source_grounded_learning_article'`.
 */
export interface ArticleJsonV3 {
  schemaVersion: ArticleV3SchemaVersion
  mode: ArticleV3Mode
  sourceKind: SourceKind
  shape: ArticleShape
  title: ArticleTitle
  /** Optional one-line deck/standfirst beneath the title. */
  dek?: string
  /** Source summary, as paragraphs (kept simple — never typed blocks). */
  abstract: ArticleParagraph[]
  /** The ordered guided learning path through the article. */
  learningPath: LearningPathItem[]
  sections: ArticleSection[]
  keyConcepts: ConceptCandidate[]
  keyClaims: ClaimCandidate[]
  terminology: TerminologyItem[]
  sourceExamples: SourceExample[]
  misconceptionWarnings: MisconceptionCandidate[]
  retrievalPrompts: RetrievalPrompt[]
  calloutPlacements: CalloutPlacementMap
  tables: ArticleTable[]
  sourceNotes: SourceNote[]
  references: SourceReference[]
  provenance: ArticleProvenance
  qualityReport: ArticleQualityReportV3
}
