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
 * Targeted regeneration of blocked articles (DET-356).
 * ===========================================================================
 *
 * A BLOCKED article (the fidelity/coverage gate rejected it) is repaired by
 * RE-RUNNING ONLY the pipeline stages implicated by WHY it failed, instead of
 * retrying the whole pipeline blindly. The gate findings are first distilled into
 * a small set of `ArticleBlocker`s (the WHY); each blocker maps to a regeneration
 * strategy (the WHICH STAGE + the WHY-WE-RERAN-IT); the repaired article keeps
 * every prior section the blockers did not implicate.
 */

/** The four repairable reasons a generated article gets BLOCKED (DET-356). */
export type ArticleBlockerReason =
  | 'low_coverage'
  | 'unsupported_claims'
  | 'missing_concepts'
  | 'poor_transcript_coherence'

/**
 * One distilled reason a generation was blocked. Derived deterministically from
 * the fidelity + coverage reports (plus concept/segmentation context), never from
 * an LLM — it is the audit of WHY the gate rejected, keyed so a repair strategy
 * can be looked up.
 */
export interface ArticleBlocker {
  reason: ArticleBlockerReason
  /** Worst severity of the underlying findings behind this blocker. */
  severity: Severity
  /** Human-readable explanation (shown when a repair fails to clear it). */
  explanation: string
  /** Evidence behind the blocker, for the inspector + targeted repair. */
  evidence: {
    /** Source blocks implicated (e.g. high-importance unrepresented blocks). */
    sourceBlockIds?: string[]
    /** Article items implicated (e.g. sections carrying unsupported claims). */
    articleRefs?: string[]
    /** A raw count behind the blocker (e.g. concept candidates found). */
    count?: number
  }
}

/** A pipeline stage a repair handler can re-run (DET-356). */
export type RegenerationStage =
  | 'conceptual_segmentation'
  | 'reshaping_plan'
  | 'generation'
  | 'claim_pruning'
  | 'learning_extraction'
  | 'fidelity_recheck'

/** One targeted repair attempt for a single blocker (DET-356). */
export interface RegenerationAction {
  blockerReason: ArticleBlockerReason
  /** The stage(s) this handler re-ran. */
  stagesRerun: RegenerationStage[]
  /** Why these stages were re-run (recorded for the inspector + analytics). */
  why: string
  /** Whether the targeted signal measurably improved after the rerun. */
  resolved: boolean
}

/** The terminal outcome of a repair pass (DET-356). */
export type RegenerationOutcome = 'repaired' | 'still_blocked' | 'no_blockers'

/**
 * The record of a single targeted-regeneration pass (DET-356). Persisted on the
 * article so the inspector can see which stage was re-run and why, which sections
 * were preserved, and — when the repair fails — a clear explanation of what is
 * still wrong.
 */
export interface RegenerationReport {
  /** Whether a repair pass actually ran (false ⇒ nothing was blocked). */
  attempted: boolean
  outcome: RegenerationOutcome
  /** The blockers detected BEFORE the repair pass. */
  blockersBefore: ArticleBlocker[]
  /** The blockers still present AFTER the repair pass. */
  blockersAfter: ArticleBlocker[]
  /** One action per blocker handled. */
  actions: RegenerationAction[]
  /** Section ids preserved verbatim from the prior (valid) generation. */
  preservedSectionIds: string[]
  /** A clear explanation of the outcome (esp. when still blocked). */
  explanation: string
  /** ISO-8601 timestamp; stamped in code, never prompt-trusted. */
  attemptedAt?: string
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
/**
 * v3 article schema version (DET-350). v3 is an ADDITIVE superset of v2: it adds
 * source-grounded generated callouts (carried inside `calloutPlacements.generated`),
 * comparison `tables`, and `sourceNotes` (references / bibliography / external links
 * / removed nav-footer / low-importance material moved out of the article body). A
 * v3 article is assignable to `ArticleJsonV2` (every new field is optional there),
 * so the existing services / web contract keep operating on the v2 shape unchanged;
 * `schemaVersion` simply bumps to `'v3'` once the new fields are attached.
 */
export const ARTICLE_SCHEMA_VERSION_V3 = 'v3' as const
export type ArticleSchemaVersion =
  | typeof ARTICLE_SCHEMA_VERSION
  | typeof ARTICLE_SCHEMA_VERSION_V3

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
  /**
   * Source-grounded GENERATED callouts (DET-350). Unlike `bySection`/`unplaced`
   * (which only RE-PLACE existing end-matter), these are new pedagogical asides
   * the callout generator distilled from the source — definitions, key ideas,
   * analogies the source draws, caveats, examples, warnings, "remember" prompts,
   * and compare cards — each grounded in real source blocks and tied to the
   * sections it relates to. Present only on v3 articles; the fidelity checker
   * rejects any whose `sourceBlockIds` are empty or unknown.
   */
  generated?: ArticleGeneratedCallout[]
}

/**
 * The pedagogical TYPE of a generated callout (DET-350). Every type is distilled
 * from the source — never from outside knowledge — so a callout can always cite
 * the blocks it came from:
 *  - 'definition'      — a term the source defines.
 *  - 'key_idea'        — a central point the source makes.
 *  - 'source_analogy'  — an analogy the SOURCE itself draws (e.g. the transformer
 *                        transcript's audio-mixer / Beatles comparison).
 *  - 'caveat'          — a qualification/limitation the source states.
 *  - 'example'         — a concrete example the source gives.
 *  - 'warning'         — a hazard/pitfall the source calls out.
 *  - 'remember'        — a fact the source stresses as worth retaining.
 *  - 'compare'         — a short A-vs-B contrast the source makes (the long-form
 *                        version becomes an `ArticleComparisonTable`).
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

/**
 * A source-grounded generated callout (DET-350). It carries new prose (a `title`
 * + `body`) but NO new information: both must be supportable from `sourceBlockIds`
 * (non-empty, all known), which the generator enforces in code and the fidelity
 * checker re-verifies. `relatedSectionIds` ties the callout to the article
 * section(s) it belongs beside (filtered to real section ids); `fidelityRisk`
 * flags how much interpretation the wording required.
 */
export interface ArticleGeneratedCallout {
  /** Deterministic id, e.g. `gco-source_analogy-0`. */
  id: string
  type: ArticleCalloutType
  title: string
  body: string
  sourceBlockIds: string[]
  relatedSectionIds: string[]
  fidelityRisk: FidelityRisk
}

/**
 * One comparison-table cell (DET-350). `sourceBlockIds` is OPTIONAL per cell —
 * "per row/cell where possible": a cell that maps cleanly to specific block(s)
 * carries them, otherwise it relies on the row-level grounding.
 */
export interface ArticleTableCell {
  text: string
  sourceBlockIds?: string[]
}

/** One comparison-table row (DET-350). The row MUST be grounded (non-empty,
 *  known `sourceBlockIds`); the fidelity checker rejects an ungrounded row. */
export interface ArticleComparisonTableRow {
  cells: ArticleTableCell[]
  sourceBlockIds: string[]
}

/**
 * A source-grounded comparison table (DET-350) — e.g. open vs closed vs isolated
 * systems, or natural vs human-made systems. The table REORGANIZES source content
 * into rows/columns but adds no external facts: every row cites the source blocks
 * it came from, and the table-level `sourceBlockIds` is the union of its rows'.
 * `relatedSectionIds` ties it to the section(s) it belongs beside.
 */
export interface ArticleComparisonTable {
  /** Deterministic id, e.g. `gtbl-0`. */
  id: string
  title: string
  /** Column headers (≥2 — a comparison needs at least two columns). */
  columns: string[]
  rows: ArticleComparisonTableRow[]
  sourceBlockIds: string[]
  relatedSectionIds: string[]
  fidelityRisk: FidelityRisk
}

/**
 * One source-note item (DET-350): a fragment moved OUT of the article body, kept
 * traceable to its source block(s). `url` is set for external links / references
 * that carry one.
 */
export interface ArticleSourceNoteItem {
  text: string
  sourceBlockIds: string[]
  url?: string
}

/**
 * Source notes (DET-350) — the end-of-article apparatus that should not interrupt
 * the reading flow. Built deterministically from the source blocks' classification
 * (no LLM, no hallucination): citations become `references`/`bibliography`,
 * URL-bearing asides become `externalLinks`, removed NAVIGATION_NOISE/FOOTER blocks
 * become `removedNavigation`, and other low-value (ad / sidebar / duplicate /
 * removed) material becomes `lowImportance`. References and bibliography move here
 * BY DEFAULT rather than living inline in the body.
 */
export interface ArticleSourceNotes {
  references: ArticleSourceNoteItem[]
  bibliography: ArticleSourceNoteItem[]
  externalLinks: ArticleSourceNoteItem[]
  removedNavigation: ArticleSourceNoteItem[]
  lowImportance: ArticleSourceNoteItem[]
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

/* ===========================================================================
 * Editorial layout — generative presentation lane (additive, NOT in articleJson).
 * ===========================================================================
 *
 * A best-effort sibling of `enrichment` / `illustrationPlan`: it does NOT carry
 * article SUBSTANCE and never mutates `articleJson`. It only references existing
 * section/block/suggestion ids and supplies the editorial FURNITURE the Compendium
 * render needs to obey the Kibadist Article Structure rules for ANY input source —
 * even a thin one. Every field that is not drawn from the source carries
 * `grounded: false` so the UI can mark it "✦ AI · not from your source".
 *
 * The web renderer also has a deterministic fallback (`editorial-layout.ts`) so an
 * article with no `editorialLayout` (older rows, a failed lane) still renders; this
 * lane makes a thin source read like a full entry.
 */

/** A two-part figure caption: a bold takeaway clause + one explanatory sentence. */
export interface EditorialCaption {
  takeaway: string
  detail: string
}

/** Where one illustration suggestion is placed in the stream and at what size. */
export interface EditorialFigurePlacement {
  /** The IllustrationSuggestion id this placement positions. */
  suggestionId: string
  /** Section the figure belongs beside. */
  sectionId: string
  /** Place AFTER this many opening paragraphs of the section (never front-loaded). */
  afterParagraphIndex: number
  /** 'span' = full-width section hero; 'column' = in-column secondary `Fig.`. */
  size: 'span' | 'column'
  /** Figure number used for the `(Fig. N)` prose binding + the plate tag. */
  figureNumber: number
  /** Optional two-part teaching caption (overrides the suggestion's own caption). */
  caption?: EditorialCaption
}

/** A marginal side-note (definition/aside) anchored beside a section's prose. */
export interface EditorialMarginalNote {
  sectionId: string
  afterParagraphIndex: number
  title: string
  text: string
  grounded: boolean
}

/** An inline sub-head inserted to chunk a long section's paragraph run. */
export interface EditorialSubhead {
  sectionId: string
  afterParagraphIndex: number
  text: string
}

/**
 * The editorial layout artifact. All fields optional — an empty object is a valid
 * (no-op) layout and old article rows simply have `null`.
 */
export interface EditorialLayout {
  /** Short eyebrow label above the headword (e.g. "Field guide · Insect"). */
  kicker?: { text: string; grounded: boolean }
  /** One-sentence standfirst/lede, used when the source abstract is thin. */
  standfirst?: { text: string; grounded: boolean }
  /** Inline sub-heads that chunk long sections. */
  subheads?: EditorialSubhead[]
  /** The single pull-quote: the article's sharpest line, placed at a thesis peak. */
  pullQuote?: {
    sectionId: string
    blockId?: string
    text: string
    grounded: boolean
  }
  /** A full-width stat band (3–4 figures) placed once where numbers cluster. */
  statBand?: {
    grounded: boolean
    stats: { figure: string; label: string }[]
  }
  /** Marginal notes (definitions/asides) spread through the body. */
  marginalNotes?: EditorialMarginalNote[]
  /** Figure placements binding illustrations next to the prose that motivates them. */
  figurePlacements?: EditorialFigurePlacement[]
}

/* ===========================================================================
 * Conceptual segmentation (DET-347) — a pre-outline learning lane.
 * ===========================================================================
 *
 * WHY this exists. The earlier pipeline modelled the source as a flat inventory
 * (structure model) and then let the reshaping plan pick blocks section-by-block.
 * For TRANSCRIPTS that produced a fragment list — each block became its own tiny
 * section and the instructor's teaching arc was lost. Conceptual segmentation
 * sits BETWEEN the structure model and the reshaping plan: it groups the
 * classified source blocks into a handful of coherent LEARNING SEGMENTS (by
 * teaching intent, not by sentence) so the outline can build sections from whole
 * concepts instead of isolated blocks.
 *
 * THE INVARIANT (same as every other stage). A segment never adds substance: it
 * only GROUPS real source blocks. Every segment carries a non-empty
 * `sourceBlockIds` drawn from the source, and `mustPreserveClaims` are quotes of
 * what the source already says (the downstream fidelity check must keep them).
 * The segment→block mapping is persisted so coverage and fidelity reports can
 * audit that no high-importance block was dropped on the floor.
 */

/** What a segment is DOING for the learner — its teaching role (DET-347). */
export type SegmentRole =
  | 'orientation'
  | 'definition'
  | 'mechanism'
  | 'distinction'
  | 'example'
  | 'analogy'
  | 'history'
  | 'application'
  | 'caveat'
  | 'summary'

/** How load-bearing a segment is for understanding the source (DET-347). */
export type SegmentImportance = 'high' | 'medium' | 'low'

/** Where a segment should land in the rendered article (DET-347). */
export type SegmentArticlePlacement = 'main_body' | 'callout' | 'source_notes'

/**
 * One coherent learning segment — an ordered group of source blocks that teach a
 * single idea. `id` is code-minted (`seg-N`) so it is stable and reproducible;
 * `sourceBlockIds` is the segment→block mapping the coverage/fidelity reports
 * audit. `mustPreserveClaims` are source claims this segment must not lose.
 */
export interface SourceSegment {
  id: string
  title: string
  role: SegmentRole
  sourceBlockIds: string[]
  importance: SegmentImportance
  summary: string
  mustPreserveClaims: string[]
  suggestedArticlePlacement: SegmentArticlePlacement
}

/**
 * The persisted conceptual-segmentation artifact (DET-347). `segments` are in
 * source-reading order (the service sorts them by their earliest cited block so
 * the teaching arc is preserved unless a later outline stage records a reorder).
 * `unsegmentedBlocks` records every non-removable block that no segment covers,
 * WITH a reason — the coverage guard guarantees no high-importance block is left
 * unsegmented without one. `warnings` carries any code-appended audit notes.
 */
export interface ConceptualSegmentation {
  segments: SourceSegment[]
  unsegmentedBlocks: { blockId: string; reason: string }[]
  warnings: string[]
}

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
  /* v3 additive fields (DET-350) — present once the callout/table/source-note
   * lanes have run; optional here so a v3 article stays assignable to v2. */
  tables?: ArticleComparisonTable[]
  sourceNotes?: ArticleSourceNotes
}

/**
 * Article JSON v3 (DET-350) — the source-grounded-extras superset of v2.
 * Discriminated on `schemaVersion: 'v3'`. It REQUIRES the three fields the v3
 * wave introduces (`calloutPlacements` now also carrying `.generated`, `tables`,
 * `sourceNotes`); everything else is inherited verbatim from v2. Because each of
 * those fields is optional on `ArticleJsonV2`, a v3 article is assignable to v2 —
 * the pipeline and web keep operating on the v2 shape and simply see the richer
 * fields when present.
 */
export interface ArticleJsonV3 extends ArticleJsonV2 {
  schemaVersion: typeof ARTICLE_SCHEMA_VERSION_V3
  calloutPlacements: ArticleCalloutPlacement
  tables: ArticleComparisonTable[]
  sourceNotes: ArticleSourceNotes
}
