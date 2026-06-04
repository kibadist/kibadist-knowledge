/**
 * Source-Preserving Article Transformer — shared JSON contracts (DET-247…259).
 *
 * FROZEN CONTRACT. This file is committed by Wave A as its first deliverable and
 * MUST NOT change without an explicit checkpoint:
 *   - Wave B builds zod schemas that satisfy these types
 *     (`z.ZodType<SourcePreservingArticle>` etc.).
 *   - Wave C mirrors THIS committed file (not the spec prose) into
 *     `web/src/lib/api.ts`.
 *   - Wave D verifies the web types structurally match this file.
 *
 * Core invariant the contract encodes: every article sentence is traceable to
 * source blocks. Every paragraph/section/term/example/caveat carries
 * `sourceBlockIds`; the fidelity + coverage reports are the audit of that.
 */

export type TransformationType =
  | 'verbatim'
  | 'grammar_cleanup'
  | 'light_reword'
  | 'paragraph_split'
  | 'paragraph_merge'
  | 'formatting_only'

export type FidelityRisk = 'low' | 'medium' | 'high'

export type Severity = 'low' | 'medium' | 'high'

export type HeadingSource = 'original' | 'light_reword' | 'inferred_from_source'

export interface ArticleParagraph {
  id: string
  text: string
  sourceBlockIds: string[]
  transformationType: TransformationType
  fidelityRisk: FidelityRisk
}

export interface ArticleSection {
  id: string
  heading: string
  headingSource: HeadingSource
  sourceBlockIds: string[]
  paragraphs: ArticleParagraph[]
}

export interface SourcePreservingArticle {
  mode: 'source_preserving_article'
  title: { text: string; source: HeadingSource }
  subtitle?: { text: string; source: HeadingSource; sourceBlockIds: string[] }
  /** Source summary assembled only from source blocks. */
  abstract: ArticleParagraph[]
  sections: ArticleSection[]
  keyTerms: { term: string; sourceBlockIds: string[] }[]
  sourceExamples: { text: string; sourceBlockIds: string[] }[]
  caveats: { text: string; sourceBlockIds: string[] }[]
  /** Source outline reference. */
  originalStructure: { blockId: string; blockType: string; preview: string }[]
}

export interface FidelityFinding {
  severity: Severity
  description: string
  articleRef?: string
  sourceBlockIds?: string[]
}

export interface FidelityReport {
  fidelityScore: number
  approved: boolean
  addedInformation: FidelityFinding[]
  lostInformation: FidelityFinding[]
  meaningChanges: FidelityFinding[]
  unsupportedHeadings: FidelityFinding[]
  missingCaveats: FidelityFinding[]
  unsupportedExamples: FidelityFinding[]
  /**
   * Emphasis shifts that come from STRUCTURE rather than wording (DET-281):
   * heavy reading-order inversion of chronological source, display emphasis
   * that overstates a point. High severity blocks approval (code-computed).
   * Backward-safe: old stored reports lack this field — schema defaults to [].
   */
  emphasisChanges: FidelityFinding[]
  /**
   * Structural fidelity findings (DET-281): untraceable typed blocks / reading
   * aids, quote-attribution loss, duplicate full rendering, claim/caveat or
   * claim/evidence cluster separation. High severity blocks approval.
   * Backward-safe: old stored reports lack this field — schema defaults to [].
   */
  structuralFindings: FidelityFinding[]
}

export interface CoverageReport {
  totalBlocks: number
  coveragePercent: number
  representedBlockIds: string[]
  removedBlocks: { blockId: string; reason: string }[]
  uncertainBlockIds: string[]
  unrepresentedBlockIds: string[]
  paragraphMap: {
    paragraphId: string
    sourceBlockIds: string[]
    transformationType: TransformationType
    fidelityRisk: FidelityRisk
  }[]
  /**
   * Audited-reorder summary (DET-275). Additive + back-compat: absent on coverage
   * reports produced before this wave. `audited` is the number of declared audit
   * entries; `unaudited` is the number of detected section moves NOT covered by
   * the audit (the fidelity checker independently blocks those). Computed by the
   * same pure `auditReorderCoverage` util the checker uses.
   */
  reorderAudit?: { audited: number; unaudited: number }
}

/* ===========================================================================
 * Article JSON v2 contract (DET-277) — the structured, typed-block evolution.
 * ===========================================================================
 *
 * WHY v2 exists. v1 (`SourcePreservingArticle` above) models a section as a flat
 * `ArticleParagraph[]`. The product needs richer, source-faithful structure:
 * lists, quotes, tables, code, pull-quotes, figure anchors and inline callouts,
 * nested subsections, heading provenance, and (in later waves) reading aids,
 * callout placement, genre shape, and audited reorderings. v2 captures all of
 * that as an ADDITIVE SUPERSET so a v1 article maps onto v2 losslessly.
 *
 * THE CONTRACT.
 *  - `schemaVersion: 'v2'` is the discriminator. Absence ⇒ legacy v1.
 *  - `mode` stays `'source_preserving_article'` (unchanged from v1).
 *  - A section's body is `blocks: ArticleBlock[]` (replacing v1 `paragraphs`),
 *    plus optional one-level `subsections`.
 *  - Heading provenance uses v2 naming `HeadingSourceV2`
 *    ('original' | 'cleanedOriginal' | 'inferred'); the adapter maps v1
 *    'original'→'original', 'light_reword'→'cleanedOriginal',
 *    'inferred_from_source'→'inferred'.
 *  - Top-level `abstract` stays `ArticleParagraph[]` (NOT blocks): it is summary
 *    matter, never carries lists/tables/figures, and keeping it as paragraphs
 *    keeps the v1→v2 adapter trivial (no abstract block-wrapping). End-matter
 *    (`keyTerms`/`sourceExamples`/`caveats`) and `originalStructure` are RETAINED
 *    verbatim from v1 — they are placement input for later waves and the compact
 *    end index.
 *
 * THE INVARIANT (unchanged from v1). Every represented fragment is traceable to
 * source blocks: every `ArticleBlock` carries a `sourceBlockIds` array (non-empty
 * for real source content). v2 widens the SHAPE of the article, never its
 * SUBSTANCE — no field here lets the AI add meaning the source did not contain.
 *
 * READ-TIME ADAPTATION. The server is the single adaptation boundary: stored v1
 * JSON is NEVER rewritten; `getArticle` adapts v1→v2 via `article-compat.util.ts`
 * (`toArticleV2`, idempotent, discriminated on `schemaVersion`) so the web only
 * ever sees v2. The generator keeps emitting v1 in this wave (DET-277); it emits
 * v2 natively from DET-271.
 *
 * FORWARD-RESERVED FIELDS. Optional top-level fields land in later waves but are
 * TYPED now so the contract is complete: `readingAids` (DET-274),
 * `calloutPlacements` (DET-272), `shape` (DET-273), `reorderings` (DET-275).
 * They are placeholder shapes — minimal but real — so schema tests can cover
 * them; their producers/consumers arrive in their waves.
 */

/** v2 article schema version discriminator. */
export const ARTICLE_SCHEMA_VERSION = 'v2' as const
export type ArticleSchemaVersion = typeof ARTICLE_SCHEMA_VERSION

/**
 * v2 heading provenance. Distinct from v1 `HeadingSource`: 'cleanedOriginal'
 * replaces 'light_reword', 'inferred' replaces 'inferred_from_source'.
 */
export type HeadingSourceV2 = 'original' | 'cleanedOriginal' | 'inferred'

/**
 * Semantic role of a section (DET-273). A section's role is DERIVED from the
 * source-derived classifications of the blocks it cites — never invented. The
 * vocabulary mirrors the source content classes the reshaping plan can ground a
 * section in:
 *  - 'definition' / 'referenceEntry' — anchored on a DEFINITION-classified block;
 *  - 'claim' — anchored on a MAIN_ARGUMENT block;
 *  - 'evidence' — anchored on an EVIDENCE block;
 *  - 'example' — anchored on an EXAMPLE block;
 *  - 'step' — anchored on an ordered LIST block (or a METHOD-classified block);
 *  - 'caveat' — qualifies a claim (a caveat from the source);
 *  - 'background' — BACKGROUND/context matter;
 *  - 'chronology' — chronological/narrative ordering.
 * The reshaping-plan service strips any role a section's cited blocks do not
 * ground (deterministic guard, post-LLM); the article copies roles from the plan.
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

/** The block-type discriminator for `ArticleBlock`. */
export type ArticleBlockType =
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'pullQuote'
  | 'table'
  | 'code'
  | 'figureAnchor'
  | 'callout'

/** Fields every v2 block carries (the traceability + provenance primitive). */
export interface ArticleBlockBase {
  id: string
  type: ArticleBlockType
  sourceBlockIds: string[]
  transformationType: TransformationType
  fidelityRisk: FidelityRisk
}

/** A prose paragraph — the v2 equivalent of a v1 `ArticleParagraph`. */
export interface ArticleParagraphBlock extends ArticleBlockBase {
  type: 'paragraph'
  text: string
}

/** An ordered or unordered list. */
export interface ArticleListBlock extends ArticleBlockBase {
  type: 'list'
  ordered: boolean
  items: string[]
}

/** A block quotation, optionally attributed. */
export interface ArticleQuoteBlock extends ArticleBlockBase {
  type: 'quote'
  text: string
  attribution?: string
}

/** A pull-quote (display excerpt of real source text). */
export interface ArticlePullQuoteBlock extends ArticleBlockBase {
  type: 'pullQuote'
  text: string
}

/** A table — optional caption, optional header row, then body rows. */
export interface ArticleTableBlock extends ArticleBlockBase {
  type: 'table'
  caption?: string
  header?: string[]
  rows: string[][]
}

/** A fenced code block. */
export interface ArticleCodeBlock extends ArticleBlockBase {
  type: 'code'
  text: string
  language?: string
}

/** An anchor where an illustration suggestion may be placed inline. */
export interface ArticleFigureAnchorBlock extends ArticleBlockBase {
  type: 'figureAnchor'
  suggestionId?: string
  caption?: string
}

/** An inline aside that exists as distinct source content (e.g. a note box). */
export interface ArticleCalloutBlock extends ArticleBlockBase {
  type: 'callout'
  calloutType?: string
  title?: string
  text: string
}

/** The discriminated union of every v2 block. */
export type ArticleBlock =
  | ArticleParagraphBlock
  | ArticleListBlock
  | ArticleQuoteBlock
  | ArticlePullQuoteBlock
  | ArticleTableBlock
  | ArticleCodeBlock
  | ArticleFigureAnchorBlock
  | ArticleCalloutBlock

/** A v2 section: typed blocks, heading provenance, optional one-level nesting. */
export interface ArticleSectionV2 {
  id: string
  heading: string
  headingSource: HeadingSourceV2
  /** Blocks grounding the heading text (provenance for the inspector). */
  headingSourceBlockIds?: string[]
  /** Optional semantic role (typed now, unused until DET-273). */
  sectionRole?: SectionRole
  sourceBlockIds: string[]
  blocks: ArticleBlock[]
  /** One level of nesting (H2→H3); typed now, exercised by fixtures. */
  subsections?: ArticleSectionV2[]
}

/* --- Forward-reserved top-level v2 fields (typed now; producers land later) --- */

/**
 * One table-of-contents entry (DET-274), derived deterministically from the
 * final article heading hierarchy. `children` carries one level of nesting
 * (subsections → H3); there is never a second level. `headingSource` mirrors the
 * section's heading provenance so the renderer can mark inferred headings.
 */
export interface TocEntry {
  sectionId: string
  heading: string
  headingSource: HeadingSourceV2
  children?: {
    sectionId: string
    heading: string
    headingSource: HeadingSourceV2
  }[]
}

/**
 * Reading aids (DET-274) — deterministic, NO LLM. `toc` and `readingTime` are
 * always present; `highlights` is omitted entirely when no verbatim/lightly-
 * cleaned source claim survives selection (the fidelity checker independently
 * blocks unsupported ones). Every highlight is a preserved, source-grounded
 * fragment with non-empty `sourceBlockIds` — never newly written.
 */
export interface ArticleReadingAids {
  /** Nested table-of-contents (one level) from the heading hierarchy. */
  toc: TocEntry[]
  /** Article-body reading time: word count + minutes (220 wpm, min 1). */
  readingTime: { wordCount: number; minutes: number }
  /** Source-grounded highlights, each traceable. Omitted when none are safe. */
  highlights?: { text: string; sourceBlockIds: string[] }[]
}

/**
 * One end-matter item (key term / source example / caveat) re-placed inline as a
 * section callout (DET-272). This is a REFERENCE WITH PLACEMENT METADATA, not a
 * new piece of content: the top-level `keyTerms` / `sourceExamples` / `caveats`
 * arrays remain the single source of truth (plan decision 8); the callout simply
 * carries the same item's `text` (and, for a key term, its `term`) plus where it
 * was placed and why. Ids are derived deterministically (e.g. `co-keyTerm-0`) —
 * never random — so placement is reproducible.
 */
export interface ArticleCallout {
  /** Deterministic id, e.g. `co-keyTerm-0` / `co-example-1` / `co-caveat-2`. */
  id: string
  kind: 'keyTerm' | 'example' | 'caveat'
  /** Present only for `keyTerm` items — the term being defined. */
  term?: string
  /** The item's display text (the term for a key term, the body otherwise). */
  text: string
  sourceBlockIds: string[]
  /** Human-readable reason, e.g. "3/4 source blocks overlap section 'Heading'". */
  placementReason: string
}

/**
 * Where inline callouts were placed + what could not be placed (DET-272).
 * `bySection` maps a section id to the callouts anchored beside it; `unplaced`
 * holds items with no confident section match (zero source-block overlap). The
 * renderer shows placed callouts as margin notes / inline cards beside their
 * section and the unplaced items in a general end-of-article group.
 */
export interface ArticleCalloutPlacement {
  bySection: Record<string, ArticleCallout[]>
  unplaced: ArticleCallout[]
}

/** Genre/shape of the article (DET-273). */
export type ArticleShape =
  | 'explainer'
  | 'argument'
  | 'procedure'
  | 'reference'
  | 'report'
  | 'narrative'
  | 'hybrid'

/** One audited reading-order move (DET-275). */
export interface ArticleReorderingAudit {
  sourceBlockId: string
  fromIndex: number
  toIndex: number
  movedWithClusterIds?: string[]
  reason: string
  risk: FidelityRisk
}

/**
 * Article JSON v2 — the structured superset of `SourcePreservingArticle`.
 * Discriminated on `schemaVersion: 'v2'`.
 */
export interface ArticleJsonV2 {
  schemaVersion: ArticleSchemaVersion
  mode: 'source_preserving_article'
  title: { text: string; source: HeadingSourceV2 }
  subtitle?: { text: string; source: HeadingSourceV2; sourceBlockIds: string[] }
  /** Source summary; kept as paragraphs (not blocks) — see contract notes. */
  abstract: ArticleParagraph[]
  sections: ArticleSectionV2[]
  keyTerms: { term: string; sourceBlockIds: string[] }[]
  sourceExamples: { text: string; sourceBlockIds: string[] }[]
  caveats: { text: string; sourceBlockIds: string[] }[]
  /** Source outline reference (unchanged from v1). */
  originalStructure: { blockId: string; blockType: string; preview: string }[]
  /* Forward-reserved optional fields (typed now; producers land later). */
  readingAids?: ArticleReadingAids
  calloutPlacements?: ArticleCalloutPlacement
  shape?: ArticleShape
  reorderings?: ArticleReorderingAudit[]
}
