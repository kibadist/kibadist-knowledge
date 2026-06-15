import { z } from 'zod'

import type {
  ArticleBlockerReason,
  ArticleJsonV2,
  ArticleJsonV3,
  ArticleParagraph,
  ArticleQualityReportV3,
  ArticleSection,
  ArticleSectionV2,
  FidelityFinding,
  FidelityReport,
  KeyClaim,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Zod schemas for every LLM artifact the M2/M3 pipeline produces (Wave B).
 *
 * These satisfy the FROZEN contracts in `transformer.types.ts` (the Article /
 * Fidelity schemas are annotated `z.ZodType<...>` so a drift from the committed
 * types is a compile error). Every preserved/representational item carries a
 * NON-EMPTY `sourceBlockIds` array — the schema is the first line of the
 * "every sentence is traceable" invariant; code guards in the services are the
 * second. The model is UNTRUSTED: passing these schemas is necessary but not
 * sufficient, so each service re-checks blockId existence in code afterwards.
 */

/** Non-empty array of source block ids — the traceability primitive. */
const sourceBlockIds = z.array(z.string().min(1)).min(1)

const transformationType = z.enum([
  'verbatim',
  'grammar_cleanup',
  'light_reword',
  'paragraph_split',
  'paragraph_merge',
  'formatting_only',
])

const fidelityRisk = z.enum(['low', 'medium', 'high'])
const severity = z.enum(['low', 'medium', 'high'])
const headingSource = z.enum([
  'original',
  'light_reword',
  'inferred_from_source',
])

// --- Structure model (step 6) ----------------------------------------------

/** One preserved item from the source, always traceable to its block(s). */
const preservedItem = z.object({
  text: z.string().min(1),
  sourceBlockIds,
})

const terminologyItem = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  sourceBlockIds,
})

const outlineEntry = z.object({
  heading: z.string().min(1),
  /** Original heading depth (1–6) when recoverable from the source (DET-276). */
  level: z.number().int().min(1).max(6).optional(),
  sourceBlockIds,
})

const noiseDecision = z.object({
  blockId: z.string().min(1),
  reason: z.string().min(1),
})

/**
 * The source structure model (DET-251): a faithful inventory of what the source
 * actually says. Title/subtitle are optional (not every source has them); every
 * other preserved item is traceable. `noiseDecisions`/`uncertainBlockIds` record
 * what the model judged droppable vs unsure — re-checked in code.
 */
export const SourceStructureModelSchema = z.object({
  title: z
    .object({ text: z.string().min(1), sourceBlockIds })
    .optional()
    .nullable(),
  subtitle: z
    .object({ text: z.string().min(1), sourceBlockIds })
    .optional()
    .nullable(),
  claims: z.array(preservedItem),
  definitions: z.array(terminologyItem),
  examples: z.array(preservedItem),
  caveats: z.array(preservedItem),
  terminology: z.array(terminologyItem),
  originalOutline: z.array(outlineEntry),
  noiseDecisions: z.array(noiseDecision),
  uncertainBlockIds: z.array(z.string().min(1)),
})

export type SourceStructureModel = z.infer<typeof SourceStructureModelSchema>

// --- Conceptual segmentation (DET-347) -------------------------------------

/** A segment's teaching role — what it does FOR THE LEARNER, not its block type. */
const segmentRole = z.enum([
  'orientation',
  'definition',
  'mechanism',
  'distinction',
  'example',
  'analogy',
  'history',
  'application',
  'caveat',
  'summary',
])

const segmentImportance = z.enum(['high', 'medium', 'low'])
const segmentArticlePlacement = z.enum(['main_body', 'callout', 'source_notes'])

/**
 * What the SEGMENTATION LLM returns (DET-347) — the segment MINUS its `id`, which
 * is code-minted (`seg-N`) after the segments are ordered, never prompt-trusted
 * (the house rule: ids the downstream relies on are owned by code). Every segment
 * still cites a non-empty `sourceBlockIds`; the `repair` hook prunes invented ids
 * before validation and the service re-checks every surviving id in code.
 * `mustPreserveClaims` are quotes of what the source already says (defaults to []).
 */
const llmSegment = z.object({
  title: z.string().min(1),
  role: segmentRole,
  sourceBlockIds,
  importance: segmentImportance,
  summary: z.string().min(1),
  mustPreserveClaims: z.array(z.string().min(1)).default([]),
  suggestedArticlePlacement: segmentArticlePlacement,
})

/**
 * The segmentation wire shape (DET-347). `segments.min(1)` so a result that groups
 * nothing is a loud failure (the pipeline degrades to no-segmentation around it).
 * `unsegmentedBlocks` records blocks the model deliberately left out of every
 * segment, each with a reason; the coverage guard in code fills in any
 * high-importance block the model forgot, so the persisted artifact always has a
 * reason for every uncovered block.
 */
export const SegmentationLlmSchema = z.object({
  segments: z.array(llmSegment).min(1),
  unsegmentedBlocks: z
    .array(
      z.object({
        blockId: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .default([]),
})

export type SegmentationLlm = z.infer<typeof SegmentationLlmSchema>

// --- Reshaping plan (step 7) -----------------------------------------------

const allowedTransformation = z.enum([
  'grammar_cleanup',
  'light_reword',
  'paragraph_split',
  'paragraph_merge',
  'formatting_only',
  'reorder',
])

/**
 * Plan heading vocabulary (DET-276). NEW plans use the v2 naming — 'original'
 * (verbatim source heading), 'cleanedOriginal' (light cleanup of a source
 * heading: typo/case/trailing punctuation only), 'inferred' (synthesized when
 * the source has no usable heading). This matches `HeadingSourceV2` so the plan
 * flows straight into the generator without translation. SAFE to rename here:
 * the only consumer of `ReshapingPlanSchema` is fresh-LLM validation in
 * `reshaping-plan.service.ts`; stored `reshapingPlan` JSON of old articles is
 * persisted but never re-validated against this schema.
 */
const planHeadingSource = z.enum(['original', 'cleanedOriginal', 'inferred'])

/**
 * Genre/shape of the article (DET-273). The reshaping plan picks the shape from
 * the source-derived block classifications; it must match `ArticleShape` in
 * transformer.types.ts. Declared here so the plan schema can require it.
 */
const planShape = z.enum([
  'explainer',
  'argument',
  'procedure',
  'reference',
  'report',
  'narrative',
  'hybrid',
])

/**
 * Per-section semantic role (DET-273), mirroring `SectionRole` in
 * transformer.types.ts. A role is GROUNDED in the source-derived classifications
 * of the section's cited blocks; the service strips any role the cited blocks do
 * not justify (deterministic, post-LLM). Declared here so the plan can carry it.
 */
const planSectionRole = z.enum([
  'definition',
  'claim',
  'evidence',
  'example',
  'step',
  'caveat',
  'background',
  'referenceEntry',
  'chronology',
])

const planSection = z
  .object({
    heading: z.string().min(1),
    headingSource: planHeadingSource,
    /** Block ids grounding the heading text (provenance for the inspector). When
     *  the heading is original/cleanedOriginal these are the source heading
     *  block(s). */
    headingSourceBlockIds: z.array(z.string().min(1)).optional(),
    /** REQUIRED when headingSource === 'inferred': why a heading had to be
     *  synthesized rather than taken from the source. Enforced by refine below. */
    headingInferenceReason: z.string().min(1).optional(),
    /** Optional source-grounded semantic role (DET-273); stripped by the service
     *  when the cited blocks' classifications do not justify it. */
    sectionRole: planSectionRole.optional(),
    sourceBlockIds,
    allowedTransformations: z.array(allowedTransformation),
    /** One level of nesting (H2→H3), present when the source carried depth. */
    subsections: z.array(z.lazy(() => planSubsection)).optional(),
  })
  .refine((s) => s.headingSource !== 'inferred' || !!s.headingInferenceReason, {
    message: 'an inferred heading must carry a headingInferenceReason',
    path: ['headingInferenceReason'],
  })

// A nested subsection mirrors a plan section minus its own subsections (one level
// only). Declared after planSection so the refine above can z.lazy-reference it.
const planSubsection = z
  .object({
    heading: z.string().min(1),
    headingSource: planHeadingSource,
    headingSourceBlockIds: z.array(z.string().min(1)).optional(),
    headingInferenceReason: z.string().min(1).optional(),
    sectionRole: planSectionRole.optional(),
    sourceBlockIds,
    allowedTransformations: z.array(allowedTransformation),
  })
  .refine((s) => s.headingSource !== 'inferred' || !!s.headingInferenceReason, {
    message: 'an inferred heading must carry a headingInferenceReason',
    path: ['headingInferenceReason'],
  })

const removedBlock = z.object({
  blockId: z.string().min(1),
  reason: z.string().min(1),
})

/**
 * One audited reading-order move (DET-275). Mirrors `ArticleReorderingAudit` in
 * transformer.types.ts. The plan MAY propose a reading-optimized order, but EVERY
 * deviation from source order must be recorded here: `sourceBlockId` is the anchor
 * block that moved; `fromIndex`/`toIndex` are its source-order → reading-order
 * positions; `movedWithClusterIds` lists blocks moved TOGETHER to keep a
 * claim/evidence/caveat/qualifier cluster intact; `reason` + `risk` make the move
 * inspectable. The deterministic guard re-checks that every detected movement is
 * covered; the fidelity cluster checks still block unsafe moves regardless.
 */
const reorderingAudit = z.object({
  sourceBlockId: z.string().min(1),
  fromIndex: z.number(),
  toIndex: z.number(),
  movedWithClusterIds: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1),
  risk: fidelityRisk,
})

/**
 * The reshaping plan (DET-252): how the article will be laid out, expressed only
 * in terms of real source blocks. `removedBlocks` may ONLY contain removable /
 * noise blocks — the service moves any protected-class violation into `warnings`
 * and keeps the block.
 */
export const ReshapingPlanSchema = z.object({
  titleProposal: z.object({
    text: z.string().min(1),
    source: planHeadingSource,
  }),
  /**
   * Genre-adaptive shape of the article (DET-273), derived from the source's
   * block classifications. REQUIRED for new plans, but `.default('hybrid')` keeps
   * the safe option for any plan that omits it (and old stored `reshapingPlan`
   * JSON is never re-validated against this schema — only fresh LLM output is).
   */
  shape: planShape.default('hybrid'),
  /** One-sentence, source-grounded justification of the shape choice (optional). */
  shapeReason: z.string().min(1).optional(),
  sections: z.array(planSection).min(1),
  removedBlocks: z.array(removedBlock),
  warnings: z.array(z.string().min(1)),
  /**
   * Audited reading-order moves (DET-275). Defaults to `[]` so a plan that keeps
   * source order needs no audit; every proposed deviation must be recorded here.
   * The service's deterministic guard appends a warning for any detected movement
   * this audit does not cover; the generator stamps these onto the article.
   */
  reorderings: z.array(reorderingAudit).default([]),
})

export type ReshapingPlan = z.infer<typeof ReshapingPlanSchema>

// --- Article (step 8) ------------------------------------------------------

const articleParagraphSchema: z.ZodType<ArticleParagraph> = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceBlockIds,
  transformationType,
  fidelityRisk,
})

const articleSectionSchema: z.ZodType<ArticleSection> = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  headingSource,
  sourceBlockIds,
  paragraphs: z.array(articleParagraphSchema),
})

/**
 * The generated article (DET-253). Annotated `z.ZodType<SourcePreservingArticle>`
 * so it can never drift from the frozen contract without a compile error. Note
 * `originalStructure` is permitted by the schema but is re-derived
 * deterministically in code from the blocks (not LLM-trusted).
 */
export const ArticleSchema: z.ZodType<SourcePreservingArticle> = z.object({
  mode: z.literal('source_preserving_article'),
  title: z.object({ text: z.string().min(1), source: headingSource }),
  subtitle: z
    .object({ text: z.string().min(1), source: headingSource, sourceBlockIds })
    .optional(),
  abstract: z.array(articleParagraphSchema),
  sections: z.array(articleSectionSchema),
  keyTerms: z.array(z.object({ term: z.string().min(1), sourceBlockIds })),
  sourceExamples: z.array(
    z.object({ text: z.string().min(1), sourceBlockIds }),
  ),
  caveats: z.array(z.object({ text: z.string().min(1), sourceBlockIds })),
  originalStructure: z.array(
    z.object({
      blockId: z.string().min(1),
      blockType: z.string().min(1),
      preview: z.string(),
    }),
  ),
})

// --- Article JSON v2 (DET-277) ---------------------------------------------

/**
 * Zod schema for the v2 article contract (`ArticleJsonV2`). Used for VALIDATION
 * and tests in this wave — the generator keeps emitting v1 (`ArticleSchema`)
 * until DET-271. Every typed block carries a non-empty `sourceBlockIds`; heading
 * provenance, nested subsections, reading aids, callout placement and reorder
 * audits are all covered so the contract is complete per the ticket's acceptance
 * criteria.
 */

const headingSourceV2 = z.enum(['original', 'cleanedOriginal', 'inferred'])

const sectionRole = z.enum([
  'definition',
  'claim',
  'evidence',
  'example',
  'step',
  'caveat',
  'background',
  'referenceEntry',
  'chronology',
])

/**
 * The narrow article `sectionRole` vocabulary (DET-273), exported so the
 * generator's pre-validation repair can strip any out-of-enum role the model
 * echoed from the richer learning-outline vocabulary before it FAILS the whole
 * article. The role is re-synced from the plan in code regardless, so dropping a
 * stray value here is purely benign shape normalization.
 */
export const SECTION_ROLE_VALUES = sectionRole.options

/** Fields shared by every v2 block. */
const blockBase = {
  id: z.string().min(1),
  sourceBlockIds,
  transformationType,
  fidelityRisk,
}

const paragraphBlock = z.object({
  ...blockBase,
  type: z.literal('paragraph'),
  text: z.string().min(1),
})

const listBlock = z.object({
  ...blockBase,
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(z.string().min(1)),
})

const quoteBlock = z.object({
  ...blockBase,
  type: z.literal('quote'),
  text: z.string().min(1),
  attribution: z.string().min(1).optional(),
})

const pullQuoteBlock = z.object({
  ...blockBase,
  type: z.literal('pullQuote'),
  text: z.string().min(1),
})

const tableBlock = z.object({
  ...blockBase,
  type: z.literal('table'),
  caption: z.string().min(1).optional(),
  header: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())),
})

const codeBlock = z.object({
  ...blockBase,
  type: z.literal('code'),
  text: z.string().min(1),
  language: z.string().min(1).optional(),
})

const figureAnchorBlock = z.object({
  ...blockBase,
  type: z.literal('figureAnchor'),
  suggestionId: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
})

const calloutBlock = z.object({
  ...blockBase,
  type: z.literal('callout'),
  calloutType: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  text: z.string().min(1),
})

const articleBlock = z.discriminatedUnion('type', [
  paragraphBlock,
  listBlock,
  quoteBlock,
  pullQuoteBlock,
  tableBlock,
  codeBlock,
  figureAnchorBlock,
  calloutBlock,
])

// Sections nest one level; declared via z.lazy so subsections reuse the schema.
const articleSectionV2: z.ZodType<ArticleSectionV2> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    heading: z.string().min(1),
    headingSource: headingSourceV2,
    headingSourceBlockIds: z.array(z.string().min(1)).optional(),
    sectionRole: sectionRole.optional(),
    sourceBlockIds,
    blocks: z.array(articleBlock),
    subsections: z.array(articleSectionV2).optional(),
  }),
)

// One TOC entry (DET-274): a section heading + provenance, with one optional
// level of child entries (subsections). Highlights are preserved source claims
// with non-empty sourceBlockIds; the array is OMITTED when none survive (so an
// empty highlights array is not produced — but if present, each entry is real).
const tocChild = z.object({
  sectionId: z.string().min(1),
  heading: z.string().min(1),
  headingSource: headingSourceV2,
})
const readingAids = z.object({
  toc: z.array(tocChild.extend({ children: z.array(tocChild).optional() })),
  readingTime: z.object({
    wordCount: z.number().int().min(0),
    minutes: z.number().int().min(1),
  }),
  highlights: z
    .array(z.object({ text: z.string().min(1), sourceBlockIds }))
    .optional(),
})

// One end-matter item (key term / example / caveat) re-placed inline as a
// callout (DET-272): a reference WITH placement metadata, not new content. The
// id is deterministic (`co-<kind>-<index>`); `term` is present only for keyTerm.
const callout = z.object({
  id: z.string().min(1),
  kind: z.enum(['keyTerm', 'example', 'caveat']),
  term: z.string().min(1).optional(),
  text: z.string().min(1),
  // Placement source ids mirror the underlying end-matter item; an unplaced item
  // may legitimately have zero overlap with any section but still carries its own
  // ids, so we do not require non-empty here (the end-matter array is the gate).
  sourceBlockIds: z.array(z.string().min(1)),
  placementReason: z.string().min(1),
})

// --- Source-grounded generated callouts + tables (DET-350) -----------------

/** The pedagogical callout vocabulary; mirrors `ArticleCalloutType`. */
const calloutType = z.enum([
  'definition',
  'key_idea',
  'source_analogy',
  'caveat',
  'example',
  'warning',
  'remember',
  'compare',
])

/**
 * A stored source-grounded generated callout (DET-350). Carries new prose
 * (title/body) but is GROUNDED: non-empty `sourceBlockIds` is the first gate (the
 * generator re-checks ids exist; the fidelity checker re-verifies). The id is
 * code-minted (`gco-<type>-<index>`), so the schema requires it.
 */
const generatedCallout = z.object({
  id: z.string().min(1),
  type: calloutType,
  title: z.string().min(1),
  body: z.string().min(1),
  sourceBlockIds,
  relatedSectionIds: z.array(z.string().min(1)),
  fidelityRisk,
})

const calloutPlacements = z.object({
  bySection: z.record(z.string(), z.array(callout)),
  unplaced: z.array(callout),
  // v3 (DET-350): the generated, source-grounded callouts. Optional so a v2
  // placement (end-matter only) still validates.
  generated: z.array(generatedCallout).optional(),
})

/** One comparison-table cell — per-cell grounding is optional ("where possible"). */
const tableCell = z.object({
  text: z.string().min(1),
  sourceBlockIds: z.array(z.string().min(1)).optional(),
})

/** One comparison-table row — row-level grounding is REQUIRED (non-empty). */
const comparisonTableRow = z.object({
  cells: z.array(tableCell).min(1),
  sourceBlockIds,
})

/** A stored source-grounded comparison table (DET-350). */
const comparisonTable = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  columns: z.array(z.string().min(1)).min(2),
  rows: z.array(comparisonTableRow).min(1),
  sourceBlockIds,
  relatedSectionIds: z.array(z.string().min(1)),
  fidelityRisk,
})

/** One source-note item (DET-350): a fragment moved out of the body, traceable. */
const sourceNoteItem = z.object({
  text: z.string().min(1),
  sourceBlockIds,
  url: z.string().min(1).optional(),
})

/** Source notes — references/bibliography/links/removed-nav/low-importance. */
const sourceNotes = z.object({
  references: z.array(sourceNoteItem),
  bibliography: z.array(sourceNoteItem),
  externalLinks: z.array(sourceNoteItem),
  removedNavigation: z.array(sourceNoteItem),
  lowImportance: z.array(sourceNoteItem),
})

const articleShape = z.enum([
  'explainer',
  'argument',
  'procedure',
  'reference',
  'report',
  'narrative',
  'hybrid',
])

/**
 * What the GENERATOR LLM is asked to return (DET-271). It is the v2 article
 * MINUS the fields the model must never be trusted for:
 *  - `schemaVersion` — stamped in code after validation, not prompt-trusted.
 *  - `readingAids` / `calloutPlacements` / `shape` / `reorderings` — owned by
 *    later waves (DET-274/272/273/275); the generator must not emit them, and the
 *    service strips any that leak through before validating against this schema.
 *  - `figureAnchor` blocks — illustrations have their own placement system, so
 *    the generator's section blocks are the union WITHOUT figureAnchor.
 *
 * `originalStructure` is still requested (left `[]`) but is re-derived
 * deterministically in code, exactly as v1 was.
 */
const llmArticleBlock = z.discriminatedUnion('type', [
  paragraphBlock,
  listBlock,
  quoteBlock,
  pullQuoteBlock,
  tableBlock,
  codeBlock,
  calloutBlock,
])

// LLM sections nest one level and never carry figureAnchor blocks.
const llmArticleSectionV2: z.ZodType<LlmArticleSectionV2> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    heading: z.string().min(1),
    headingSource: headingSourceV2,
    headingSourceBlockIds: z.array(z.string().min(1)).optional(),
    // The generator may carry a section role copied from the plan (DET-273); the
    // service re-syncs roles from the plan in code, so this is never trusted.
    sectionRole: sectionRole.optional(),
    sourceBlockIds,
    blocks: z.array(llmArticleBlock),
    subsections: z.array(llmArticleSectionV2).optional(),
  }),
)

/** The block shape the generator LLM may emit (no figureAnchor). */
export type LlmArticleBlock = z.infer<typeof llmArticleBlock>

/** A generator-LLM section (no schemaVersion-stamped wrapper, no figureAnchor). */
export interface LlmArticleSectionV2 {
  id: string
  heading: string
  headingSource: z.infer<typeof headingSourceV2>
  headingSourceBlockIds?: string[]
  sectionRole?: z.infer<typeof sectionRole>
  sourceBlockIds: string[]
  blocks: LlmArticleBlock[]
  subsections?: LlmArticleSectionV2[]
}

export const ArticleLlmV2Schema = z.object({
  mode: z.literal('source_preserving_article'),
  title: z.object({ text: z.string().min(1), source: headingSourceV2 }),
  subtitle: z
    .object({
      text: z.string().min(1),
      source: headingSourceV2,
      sourceBlockIds,
    })
    .optional(),
  abstract: z.array(articleParagraphSchema),
  sections: z.array(llmArticleSectionV2),
  keyTerms: z.array(z.object({ term: z.string().min(1), sourceBlockIds })),
  sourceExamples: z.array(
    z.object({ text: z.string().min(1), sourceBlockIds }),
  ),
  caveats: z.array(z.object({ text: z.string().min(1), sourceBlockIds })),
  originalStructure: z
    .array(
      z.object({
        blockId: z.string().min(1),
        blockType: z.string().min(1),
        preview: z.string(),
      }),
    )
    .optional()
    .default([]),
})

export type ArticleLlmV2 = z.infer<typeof ArticleLlmV2Schema>

// --- Key claims — the v3 claims layer (DET-352) ----------------------------

/** The claim taxonomy (mirrors `ClaimType` in transformer.types.ts). */
const claimType = z.enum([
  'definition',
  'mechanism',
  'distinction',
  'historical_claim',
  'causal_claim',
  'classification',
  'example',
  'caveat',
])

/**
 * A stored key claim (`KeyClaim`). Annotated `z.ZodType<KeyClaim>` so it can never
 * drift from the frozen contract. Both `sourceBlockIds` and `articleSectionIds`
 * are non-empty — a claim with no provenance or no home section is never stored
 * (the service drops it in code). `confidence` is clamped to 0–1 in code.
 */
const keyClaim: z.ZodType<KeyClaim> = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceBlockIds,
  articleSectionIds: z.array(z.string().min(1)).min(1),
  claimType,
  confidence: z.number().min(0).max(1),
})

/**
 * What the CLAIM-EXTRACTOR LLM returns (DET-352) — no `id` (code mints it) and no
 * `articleSectionIds` (code DERIVES them from the article's section→block map, so
 * the model is never trusted for structural mapping; it only reports the claim,
 * its grounding blocks, its type and a confidence). `sourceBlockIds` is loosened
 * to allow empties so the service can DROP ungrounded claims in code rather than
 * the model omitting them to satisfy the schema (mirrors the learning-layer lane).
 * `confidence` defaults to 0.5 and is clamped in code.
 */
export const ClaimExtractionLlmSchema = z.object({
  claims: z.array(
    z.object({
      text: z.string().min(1),
      sourceBlockIds: z.array(z.string()).default([]),
      claimType,
      confidence: z.number().catch(0.5).default(0.5),
    }),
  ),
})

export type ClaimExtractionLlm = z.infer<typeof ClaimExtractionLlmSchema>

// The shared structured-article object. Kept as a raw ZodObject (not the
// `z.ZodType<>`-annotated export) so the v3 schema can `.extend` it.
const articleJsonObject = z.object({
  schemaVersion: z.literal('v2'),
  mode: z.literal('source_preserving_article'),
  title: z.object({ text: z.string().min(1), source: headingSourceV2 }),
  subtitle: z
    .object({
      text: z.string().min(1),
      source: headingSourceV2,
      sourceBlockIds,
    })
    .optional(),
  abstract: z.array(articleParagraphSchema),
  sections: z.array(articleSectionV2),
  keyTerms: z.array(z.object({ term: z.string().min(1), sourceBlockIds })),
  sourceExamples: z.array(
    z.object({ text: z.string().min(1), sourceBlockIds }),
  ),
  caveats: z.array(z.object({ text: z.string().min(1), sourceBlockIds })),
  originalStructure: z.array(
    z.object({
      blockId: z.string().min(1),
      blockType: z.string().min(1),
      preview: z.string(),
    }),
  ),
  readingAids: readingAids.optional(),
  calloutPlacements: calloutPlacements.optional(),
  shape: articleShape.optional(),
  reorderings: z.array(reorderingAudit).optional(),
  keyClaims: z.array(keyClaim).optional(),
  // v3 additive fields (DET-350); optional so a v2 article still validates.
  tables: z.array(comparisonTable).optional(),
  sourceNotes: sourceNotes.optional(),
})

export const ArticleJsonV2Schema: z.ZodType<ArticleJsonV2> = articleJsonObject

/**
 * Article JSON v3 (DET-350) — the v2 object with `schemaVersion: 'v3'` and the
 * three v3 fields promoted to REQUIRED (generated callouts live inside
 * `calloutPlacements`, plus `tables` and `sourceNotes`). Validates a native v3
 * article end-to-end.
 */
export const ArticleJsonV3Schema: z.ZodType<ArticleJsonV3> =
  articleJsonObject.extend({
    schemaVersion: z.literal('v3'),
    calloutPlacements,
    tables: z.array(comparisonTable),
    sourceNotes,
  }) as unknown as z.ZodType<ArticleJsonV3>

// --- Fidelity report (step 9) ----------------------------------------------

const fidelityFinding: z.ZodType<FidelityFinding> = z.object({
  severity,
  description: z.string().min(1),
  articleRef: z.string().optional(),
  sourceBlockIds: z.array(z.string().min(1)).optional(),
})

/**
 * The fidelity report (DET-254). The LLM proposes findings + a score; the FINAL
 * `approved` boolean is recomputed in code (never trusted from the model). The
 * schema accepts whatever `approved` the model emits so we can overwrite it.
 */
export const FidelityReportSchema: z.ZodType<FidelityReport> = z.object({
  fidelityScore: z.number(),
  approved: z.boolean(),
  addedInformation: z.array(fidelityFinding),
  lostInformation: z.array(fidelityFinding),
  meaningChanges: z.array(fidelityFinding),
  unsupportedHeadings: z.array(fidelityFinding),
  missingCaveats: z.array(fidelityFinding),
  unsupportedExamples: z.array(fidelityFinding),
  // Backward-safe (DET-281): old stored fidelityReport JSON predates these two
  // groups, so `.default([])` lets a re-read of an old report still parse.
  emphasisChanges: z.array(fidelityFinding).default([]),
  structuralFindings: z.array(fidelityFinding).default([]),
})

// --- Article quality report v3 (fidelity review, DET-354) ------------------

const qualityStage = z.enum([
  'structure-model',
  'reshaping-plan',
  'generator',
  'learning-layer',
])

const articleBlockerReason: z.ZodType<ArticleBlockerReason> = z.object({
  code: z.string().min(1),
  dimension: z.string().min(1),
  severity,
  message: z.string().min(1),
  articleRefs: z.array(z.string().min(1)).optional(),
  sourceBlockIds: z.array(z.string().min(1)).optional(),
  stage: qualityStage,
})

/**
 * The v3 quality report (DET-354). Produced deterministically by the fidelity
 * review; this schema exists for read-back / persistence safety (validating a
 * stored `qualityReport` JSON), mirroring how the fidelity + article schemas pin
 * their committed contracts with `z.ZodType<...>` so a drift is a compile error.
 */
export const ArticleQualityReportV3Schema: z.ZodType<ArticleQualityReportV3> =
  z.object({
    sourceCoverageScore: z.number(),
    importantSourceCoverageScore: z.number(),
    citationCoverageScore: z.number(),
    unsupportedClaimCount: z.number(),
    highSeverityLostInfoCount: z.number(),
    conceptCandidateCount: z.number(),
    keyClaimCount: z.number(),
    retrievalPromptCount: z.number(),
    tableCount: z.number(),
    calloutCount: z.number(),
    exerciseReadinessScore: z.number(),
    articleReadabilityScore: z.number(),
    provenanceCompletenessScore: z.number(),
    reviewerWarnings: z.array(z.string()),
    blockerReasons: z.array(articleBlockerReason),
    regenerationHints: z.array(z.string()),
  })

// --- Illustration plan (step 10, DET-259) ----------------------------------

const illustrationType = z.enum([
  'editorial_cover',
  'decorative_section',
  'source_based_diagram',
])
const approval = z.enum(['pending', 'approved', 'rejected'])

/** Stored suggestion (includes the code-managed approval state). */
const illustrationSuggestion = z.object({
  id: z.string().min(1),
  illustrationType,
  purpose: z.string().min(1),
  visualDescription: z.string().min(1),
  caption: z.string().min(1),
  fidelityRisk,
  reason: z.string().min(1),
  sourceBlockIds,
  // The article section ids this suggestion is anchored to (DET-360), derived in
  // CODE from the sections whose blocks the suggestion cites — never trusted from
  // the LLM. A source_based_diagram MUST resolve to at least one section (a
  // diagram spec references both source blocks and article sections); the
  // planner drops a diagram that grounds in no section. Omitted when empty.
  sectionIds: z.array(z.string().min(1)).optional(),
  // Quality gate (DET-360). `eligible` is code-managed: false means the article
  // did not pass its structure/quality gates, so the suggestion is a DRAFT that
  // must not be rendered. Optional and back-compatible — old stored plans predate
  // this field, and an absent value is treated as eligible (only an explicit
  // `eligible === false` blocks rendering, mirroring the web contract). The
  // planner always sets it explicitly. `qualityWarning` carries the
  // human-readable reason when a suggestion is ineligible.
  eligible: z.boolean().optional(),
  qualityWarning: z.string().min(1).optional(),
  approval,
  // Rendered-image metadata (DET-261). Absent/null until the approved suggestion
  // is rendered; never set by the LLM (the LLM schema below has no `image`). The
  // bytes live in TransformerIllustrationImage; the frontend derives the fetch
  // path from (articleId, suggestionId) — no URL is stored here.
  image: z
    .object({
      width: z.number(),
      height: z.number(),
      provider: z.string(),
      model: z.string(),
      generatedAt: z.string(), // ISO timestamp
    })
    .nullish(),
})

export type IllustrationSuggestion = z.infer<typeof illustrationSuggestion>

export const IllustrationPlanSchema = z.object({
  suggestions: z.array(illustrationSuggestion),
})

export type IllustrationPlan = z.infer<typeof IllustrationPlanSchema>

/**
 * What the LLM is asked to return — no `id`/`approval` (code mints the id and
 * forces `approval='pending'`). `sourceBlockIds` is loosened to allow empties so
 * the service can DROP them in code per DET-259 rather than the model silently
 * skipping the suggestion to satisfy the schema.
 */
export const IllustrationSuggestionLlmSchema = z.object({
  illustrationType,
  purpose: z.string().min(1),
  visualDescription: z.string().min(1),
  caption: z.string().min(1),
  fidelityRisk,
  reason: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
})

export const IllustrationPlanLlmSchema = z.object({
  suggestions: z.array(IllustrationSuggestionLlmSchema),
})

// --- Article enrichment (AI augmentation lane, DET-319) --------------------
//
// The ONE deliberately NON-source-grounded artifact. Every other stage may only
// reshape the source; enrichment is the model's own ENCYCLOPEDIC WORLD KNOWLEDGE
// about the article's topic (pronunciation, etymology, classification, infobox
// key-facts). It lives in its own `enrichment` column, never in `articleJson`,
// and the UI labels it "✦ AI · not from your source". Every field is optional —
// the model omits anything it isn't confident about and returns empty when the
// article isn't about a discrete encyclopedic subject, to bound hallucination.
const enrichmentKeyFact = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
})

export const ArticleEnrichmentSchema = z.object({
  /** IPA pronunciation of the headword, e.g. "/ˈhʌn.i/". */
  pronunciation: z.string().min(1).optional(),
  /** Part of speech for a single-term topic, e.g. "noun". */
  partOfSpeech: z.string().min(1).optional(),
  /** 1–2 sentence, well-established etymology. */
  etymology: z.string().min(1).optional(),
  /** A short domain category, e.g. "Concept · Computer science". */
  classification: z.string().min(1).optional(),
  /** Encyclopedia infobox facts (label/value); the service slices to a few. */
  keyFacts: z.array(enrichmentKeyFact).default([]),
})

export type ArticleEnrichment = z.infer<typeof ArticleEnrichmentSchema>

// --- Editorial layout (generative presentation lane) -----------------------
//
// What the EDITORIAL-LAYOUT LLM returns — the editorial FURNITURE that makes a
// thin source render as a full Compendium entry (kicker, standfirst, sub-heads,
// a chosen pull-quote, a stat band, marginal notes). Like enrichment it is an
// ADDITIVE lane: it never mutates `articleJson` and only references existing
// section/block ids. The model MAY write connective/editorial text here (the one
// place generative furniture is allowed), so every field carries `grounded` —
// false whenever the text is not lifted from the article.
//
// The schema is deliberately PERMISSIVE (optional fields, lenient `grounded`
// default, no id-existence check). The strict work — dropping furniture that
// cites an unknown section/block id and clamping every `afterParagraphIndex` —
// is done in code by `sanitizeEditorialLayout`, mirroring how the illustration
// and learning lanes loosen their LLM schema and re-check in the service. We do
// NOT redefine the canonical `EditorialLayout` type — it lives in
// transformer.types.ts; this is only the wire shape of the model's reply.
//
// `figurePlacements` is intentionally absent: this lane runs INLINE (before the
// illustrations are planned in the background), so suggestion ids don't exist
// yet — the web renderer owns figure placement deterministically.

/** Lenient grounded flag — defaults to false (ungrounded gets the ✦ AI mark). */
const groundedFlag = z.boolean().catch(false).default(false)

/** Clampable paragraph anchor — the sanitizer clamps it to the real range. */
const afterParagraphIndex = z.number().int().catch(0).default(0)

export const EditorialLayoutLlmSchema = z.object({
  /** Short eyebrow label above the headword, e.g. "Field guide · Insect". */
  kicker: z
    .object({ text: z.string().min(1), grounded: groundedFlag })
    .optional(),
  /** One-sentence standfirst/lede for a thin source abstract. */
  standfirst: z
    .object({ text: z.string().min(1), grounded: groundedFlag })
    .optional(),
  /** Inline sub-heads chunking a long section (sanitizer drops bad sectionIds). */
  subheads: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        afterParagraphIndex,
        text: z.string().min(1),
      }),
    )
    .default([]),
  /** The single sharpest line; blockId optional, grounded only when verbatim. */
  pullQuote: z
    .object({
      sectionId: z.string().min(1),
      blockId: z.string().min(1).optional(),
      text: z.string().min(1),
      grounded: groundedFlag,
    })
    .optional(),
  /** A stat band; the sanitizer omits it below 3 stats. */
  statBand: z
    .object({
      grounded: groundedFlag,
      stats: z
        .array(
          z.object({
            figure: z.string().min(1),
            label: z.string().min(1),
          }),
        )
        .default([]),
    })
    .optional(),
  /** Marginal notes (definitions/asides) anchored beside a section's prose. */
  marginalNotes: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        afterParagraphIndex,
        title: z.string().min(1),
        text: z.string().min(1),
        grounded: groundedFlag,
      }),
    )
    .default([]),
})

export type EditorialLayoutLlm = z.infer<typeof EditorialLayoutLlmSchema>

// --- Learning layer (step 11, DET-258) -------------------------------------

const validationStatus = z.enum(['pending', 'validated', 'dismissed'])

const learningConcept = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  definition: z.string().min(1),
  sourceBlockIds,
  validationStatus,
})

export type LearningConcept = z.infer<typeof learningConcept>

const retrievalPrompt = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  sourceBlockIds,
  // Additive v3 review fields (DET-359). All optional so learning-layer rows
  // stored before this lane still parse. `reviewStatus` is the lifecycle the v3
  // panel persists; it never includes a "scheduled" state — permanent review
  // scheduling stays a downstream, explicitly-gated step.
  promptType: z.string().min(1).optional(),
  linkedConceptIds: z.array(z.string()).optional(),
  expectedAnswerBlockIds: z.array(z.string()).optional(),
  reviewStatus: z
    .enum(['suggested', 'saved', 'answered', 'rejected'])
    .optional(),
  userAnswer: z.string().optional(),
})

export type RetrievalPrompt = z.infer<typeof retrievalPrompt>

/**
 * A per-section concept-extraction CANDIDATE (DET-283). A proposal — never an
 * earned/library Concept: `aiAssisted` is forced true and `validationStatus`
 * starts 'pending'; validating it ONLY flips the status, it never creates any
 * Concept row. Every candidate is scoped to the v2 section it was extracted from
 * (`sectionId`) and grounded in that section's real source blocks
 * (`sourceBlockIds`, non-empty — the service drops ungrounded ones). `blockType`
 * / `sectionRole` are metadata stamped IN CODE from the actual section, never
 * trusted from the LLM. Stored as an additive parallel array on `LearningLayer`,
 * so old learning-layer rows (without `conceptCandidates`) stay valid.
 */
const learningConceptCandidate = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  label: z.string().min(1),
  definition: z.string().min(1),
  sourceBlockIds,
  blockType: z.string().min(1).optional(),
  sectionRole: z.string().min(1).optional(),
  aiAssisted: z.literal(true),
  validationStatus,
  // Set when the user VALIDATES the candidate: the id of the INBOX "to learn"
  // Concept that validation created (DET-283). Its presence makes promotion
  // idempotent — re-validating never creates a second Concept row.
  conceptId: z.string().min(1).optional(),
  // Additive v3 review fields (DET-359). Optional so old rows still parse; the
  // v3 adapter defaults importance to 'medium' when absent.
  importance: z.enum(['high', 'medium', 'low']).optional(),
  sourceSpanPreview: z.string().min(1).optional(),
})

export type LearningConceptCandidate = z.infer<typeof learningConceptCandidate>

// --- Article-level concept extraction (DET-351) ----------------------------
//
// A WHOLE-ARTICLE learning-extraction stage that runs after generation and
// returns rich concept candidates + terminology + relationships for the Concept
// Library / Proof-of-Learning flow. Distinct from the DET-258 study layer and the
// DET-283 per-section candidates: this stage covers the full article in one pass
// so a concept-rich source can never finalize with zero candidates (the bug this
// fixes — both observed failures returned conceptCandidateCount: 0).
//
// Like every other extraction lane the model is UNTRUSTED. The LLM proposes the
// candidates; CODE owns the invariants (`learning-layer.service.ts`):
//  - grounding: a candidate without ≥1 real sourceBlockId is dropped;
//  - `normalizedName` is computed in code (never prompt-trusted) and candidates
//    are deduplicated by it (acceptance criterion);
//  - `articleSectionIds` are resolved in code from the candidate's grounded
//    blocks against the article's section index, never taken from the model;
//  - `eligibleForLibraryReview` is set in code from importance (high ⇒ eligible);
//  - `validationStatus` is forced 'pending' and `aiAssisted` true — NOTHING is
//    auto-promoted to permanent knowledge without explicit user validation.

const conceptCandidateType = z.enum([
  'core_concept',
  'supporting_concept',
  'term',
  'process',
  'distinction',
  'method',
  'model',
  'misconception',
])

export type ConceptCandidateType = z.infer<typeof conceptCandidateType>

const conceptImportance = z.enum(['high', 'medium', 'low'])
export type ConceptImportance = z.infer<typeof conceptImportance>

/** Cognitive state a freshly-extracted candidate may be SUGGESTED for — never the
 *  earned states; extraction can only propose 'Seen' or 'Parsed'. */
const suggestedCognitiveState = z.enum(['Seen', 'Parsed'])

const conceptRelationshipType = z.enum([
  'related_to',
  'prerequisite_of',
  'confused_with',
  'contrasts_with',
  'example_of',
  'applied_in',
  'misconception_about',
])

export type ConceptRelationshipType = z.infer<typeof conceptRelationshipType>

/**
 * A proposed relationship between two concept candidates. `targetNormalizedName`
 * points at another candidate's code-computed `normalizedName`; the service drops
 * any relationship whose target does not resolve to a real candidate (no dangling
 * edges) and whose `type` is not a known relationship kind.
 */
const conceptRelationshipCandidate = z.object({
  type: conceptRelationshipType,
  targetNormalizedName: z.string().min(1),
  rationale: z.string().min(1).optional(),
})

export type ConceptRelationshipCandidate = z.infer<
  typeof conceptRelationshipCandidate
>

/**
 * A whole-article concept CANDIDATE (DET-351). A proposal for the Concept
 * Library — never an earned Concept: `aiAssisted` is forced true and
 * `validationStatus` starts 'pending'. `name`/`type`/`importance` come from the
 * model; `normalizedName`, `articleSectionIds` and `eligibleForLibraryReview` are
 * code-owned. `sourceBlockIds` is non-empty (grounding is required; the service
 * drops ungrounded candidates). `conceptId` is stamped only when the user later
 * validates the candidate, making promotion idempotent.
 */
const articleConceptCandidate = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  normalizedName: z.string().min(1),
  domain: z.string().min(1).optional(),
  type: conceptCandidateType,
  shortDefinition: z.string().min(1).optional(),
  sourceBlockIds,
  articleSectionIds: z.array(z.string().min(1)),
  importance: conceptImportance,
  suggestedCognitiveState,
  /** Code-set from importance: high-importance candidates are surfaced for
   *  Concept Library review (and potential Living Concept generation). */
  eligibleForLibraryReview: z.boolean(),
  aiAssisted: z.literal(true),
  validationStatus,
  conceptId: z.string().min(1).optional(),
  relationshipCandidates: z.array(conceptRelationshipCandidate).optional(),
})

export type ArticleConceptCandidate = z.infer<typeof articleConceptCandidate>

// --- Learning prompts: retrieval + misconceptions (DET-353) -----------------
//
// A SEPARATE study aid from the DET-258 learning layer above: AI-suggested active
// recall prompts and misconception candidates, generated from source-grounded
// article content (sections, concept candidates, key claims, source examples,
// callouts). Like every other lane the model is UNTRUSTED — the service grounds
// every item against the real source block ids, validates concept-candidate links,
// mints ids, and forces every status to its AI-suggested initial value. NOTHING is
// scheduled permanently here: a prompt becomes a real review card only when the
// user validates or answers it (status flips downstream, never at generation).
//
// NOTE on naming: the canonical ticket interface is `RetrievalPrompt`, but that
// name is already taken by the DET-258 learning layer's simpler `{id, prompt,
// sourceBlockIds}` shape above. We call the richer DET-353 shape
// `RetrievalPromptCandidate` to avoid the collision and to emphasise it is a
// candidate — never a permanent card until the learner validates it.

/** The pedagogical category of a retrieval prompt (DET-353). */
const retrievalPromptType = z.enum([
  'definition',
  'mechanism',
  'distinction',
  'sequence',
  'analogy',
  'misconception_repair',
  'transfer',
])

export type RetrievalPromptType = z.infer<typeof retrievalPromptType>

const promptDifficulty = z.enum(['easy', 'medium', 'hard'])

/** Retrieval-prompt lifecycle: AI suggests, the learner validates/answers or rejects. */
const retrievalPromptStatus = z.enum([
  'ai_suggested',
  'user_validated',
  'rejected',
])

/** Misconception lifecycle: AI suggests, the learner validates or rejects. */
const misconceptionStatus = z.enum(['ai_suggested', 'validated', 'rejected'])

/**
 * A stored active-recall prompt (DET-353). `question` is the prompt the learner
 * answers; `expectedAnswerSourceBlockIds` are the REAL source blocks whose content
 * holds the answer (non-empty — the service drops any prompt it cannot ground);
 * `relatedConceptCandidateIds` link the prompt to the concept candidates it tests
 * (validated against the article's candidates in code). `status` starts
 * `ai_suggested` and only the learner ever advances it — nothing is scheduled as a
 * permanent review card at generation time.
 */
const retrievalPromptCandidate = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expectedAnswerSourceBlockIds: sourceBlockIds,
  relatedConceptCandidateIds: z.array(z.string().min(1)),
  promptType: retrievalPromptType,
  difficulty: promptDifficulty,
  status: retrievalPromptStatus,
})

export type RetrievalPromptCandidate = z.infer<typeof retrievalPromptCandidate>

/**
 * A stored misconception candidate (DET-353): a likely wrong belief plus its
 * source-faithful correction. `sourceBlockIds` MAY be empty — per the ticket a
 * misconception is allowed when it is either source-grounded OR clearly marked as
 * AI-suggested; an ungrounded one is kept but stays `ai_suggested` (and the
 * permanent-card gate never schedules it until the learner validates). `confidence`
 * is clamped to [0,1] in code.
 */
const misconceptionCandidate = z.object({
  id: z.string().min(1),
  misconception: z.string().min(1),
  correction: z.string().min(1),
  sourceBlockIds: z.array(z.string().min(1)),
  relatedConceptCandidateIds: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  status: misconceptionStatus,
})

export type MisconceptionCandidate = z.infer<typeof misconceptionCandidate>

/** The generated learning-prompt set (retrieval prompts + misconceptions). */
export const LearningPromptSetSchema = z.object({
  retrievalPrompts: z.array(retrievalPromptCandidate),
  misconceptions: z.array(misconceptionCandidate),
})

export type LearningPromptSet = z.infer<typeof LearningPromptSetSchema>

/**
 * What the LLM returns for the learning-prompt stage (DET-353) — no id/status
 * (code mints ids and forces the initial status). Source-block id arrays and
 * concept-candidate id arrays are loosened to allow empties / unknowns so the
 * service can DROP retrieval prompts that ground in nothing and FILTER invalid
 * links in code, rather than the model silently omitting them to satisfy the
 * schema. `promptType` / `difficulty` fall back to safe defaults on benign drift;
 * `confidence` defaults to 0.5 and is clamped in code.
 */
export const LearningPromptSetLlmSchema = z.object({
  retrievalPrompts: z.array(
    z.object({
      question: z.string().min(1),
      expectedAnswerSourceBlockIds: z.array(z.string()).default([]),
      relatedConceptCandidateIds: z.array(z.string()).default([]),
      promptType: retrievalPromptType.catch('definition'),
      difficulty: promptDifficulty.catch('medium'),
    }),
  ),
  misconceptions: z.array(
    z.object({
      misconception: z.string().min(1),
      correction: z.string().min(1),
      sourceBlockIds: z.array(z.string()).default([]),
      relatedConceptCandidateIds: z.array(z.string()).default([]),
      confidence: z.number().catch(0.5).default(0.5),
    }),
  ),
})

/**
 * Stored learning layer (code-managed ids + validationStatus). `conceptCandidates`
 * (DET-283) and `articleConceptCandidates` (DET-351) are ADDITIVE optional parallel
 * arrays: old stored rows predate them and still parse. `retrievalPromptCandidates`
 * / `misconceptions` are the same kind of additive optional arrays (DET-353) — the
 * richer recall prompts + misconception candidates produced by the learning-prompt
 * stage. `concepts` / `retrievalPrompts` and their update flow are untouched.
 */
/**
 * The v3 reader's review decision for ONE concept candidate (DET-359), keyed by
 * the Article JSON v3 `keyConcepts[].id`. `accepted` is a USER-REVIEW state, not
 * internalized knowledge — there is deliberately NO concept-row side effect here
 * (unlike `conceptCandidates` validation), so accepting can never internalize a
 * concept. `label` / `definition` / `importance` hold the reader's in-place edit.
 */
export const v3ConceptReview = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'deferred']),
  label: z.string().optional(),
  definition: z.string().optional(),
  importance: z.enum(['high', 'medium', 'low']).optional(),
})
export type LearningLayerV3ConceptReview = z.infer<typeof v3ConceptReview>

/**
 * The v3 reader's review decision for ONE retrieval prompt (DET-359), keyed by
 * the Article JSON v3 `retrievalPrompts[].id`. The statuses exclude any
 * "scheduled" value: this overlay can never make a prompt a permanent review
 * card — scheduling stays a separately-gated downstream step. `userAnswer` is
 * the scheduling gate (a user-authored answer); `prompt` holds an in-place edit.
 */
export const v3PromptReview = z.object({
  status: z.enum(['suggested', 'saved', 'answered', 'rejected']),
  userAnswer: z.string().optional(),
  prompt: z.string().optional(),
})
export type LearningLayerV3PromptReview = z.infer<typeof v3PromptReview>

/**
 * The v3 review overlay (DET-359): an id-keyed map of the reader's review state
 * for the Article JSON v3 concept candidates + retrieval prompts. The article
 * BODY holds the suggestions; this holds only the per-item decision, so the same
 * concepts/prompts shown in the v3 reader become reviewable without copying them
 * into a parallel `conceptCandidates` lane (and without that lane's concept-row
 * side effects). Additive + optional: rows generated before this lane omit it.
 */
export const v3ReviewSchema = z.object({
  concepts: z.record(z.string(), v3ConceptReview).optional(),
  prompts: z.record(z.string(), v3PromptReview).optional(),
})
export type LearningLayerV3Review = z.infer<typeof v3ReviewSchema>

export const LearningLayerSchema = z.object({
  concepts: z.array(learningConcept),
  retrievalPrompts: z.array(retrievalPrompt),
  conceptCandidates: z.array(learningConceptCandidate).optional(),
  articleConceptCandidates: z.array(articleConceptCandidate).optional(),
  retrievalPromptCandidates: z.array(retrievalPromptCandidate).optional(),
  misconceptions: z.array(misconceptionCandidate).optional(),
  // The v3 reader's review overlay (DET-359), keyed by Article JSON v3 item ids.
  v3Review: v3ReviewSchema.optional(),
})

export type LearningLayer = z.infer<typeof LearningLayerSchema>

/**
 * What the LLM returns — no id/validationStatus (code mints ids and forces
 * `validationStatus='pending'`). `sourceBlockIds` loosened so the service drops
 * invalid items in code rather than the model omitting them to pass the schema.
 */
export const LearningLayerLlmSchema = z.object({
  concepts: z.array(
    z.object({
      label: z.string().min(1),
      definition: z.string().min(1),
      sourceBlockIds: z.array(z.string()).default([]),
    }),
  ),
  retrievalPrompts: z.array(
    z.object({
      prompt: z.string().min(1),
      sourceBlockIds: z.array(z.string()).default([]),
    }),
  ),
})

/**
 * What the LLM returns for per-section concept extraction (DET-283) — only
 * `label` / `definition` / `sourceBlockIds`. The id, sectionId, blockType,
 * sectionRole, aiAssisted flag and validationStatus are all CODE-OWNED (stamped
 * after validation, never prompt-trusted). `sourceBlockIds` is loosened to allow
 * empties so the service can DROP ungrounded candidates in code rather than the
 * model omitting them to satisfy the schema (mirrors LearningLayerLlmSchema).
 */
export const ConceptCandidatesLlmSchema = z.object({
  candidates: z.array(
    z.object({
      label: z.string().min(1),
      definition: z.string().min(1),
      sourceBlockIds: z.array(z.string()).default([]),
    }),
  ),
})

// --- Source-grounded callout / table LLM wire shapes (DET-350) --------------
//
// What the callout / table generators ask the model for. As with the
// illustration and learning lanes, `sourceBlockIds` / `relatedSectionIds` are
// LOOSENED (plain string arrays, default []) so the SERVICE drops ungrounded
// items in code rather than the model silently omitting them to satisfy the
// schema; the id is code-minted (absent here); `fidelityRisk` defaults to the
// cautious 'medium' when the model omits it.

export const GeneratedCalloutsLlmSchema = z.object({
  callouts: z.array(
    z.object({
      type: calloutType,
      title: z.string().min(1),
      body: z.string().min(1),
      sourceBlockIds: z.array(z.string()).default([]),
      relatedSectionIds: z.array(z.string()).default([]),
      fidelityRisk: fidelityRisk.default('medium'),
    }),
  ),
})

/**
 * What the LLM returns for the DET-351 whole-article extraction. Deliberately
 * PERMISSIVE so a single off-taxonomy value never fails the whole pass:
 *  - `type` / `importance` / `suggestedCognitiveState` fall back via `.catch`;
 *  - `sourceBlockIds` is loosened to allow empties — the service drops ungrounded
 *    candidates in code rather than the model omitting them to pass the schema;
 *  - relationship `type` / `targetName` stay free `string`s; the service maps
 *    them to the known relationship enum and resolves targets to real candidates,
 *    dropping anything that does not resolve.
 * Everything code-owns (`id`, `normalizedName`, `articleSectionIds`,
 * `eligibleForLibraryReview`, `validationStatus`, `aiAssisted`) is ABSENT here.
 */
export const ArticleConceptExtractionLlmSchema = z.object({
  candidates: z.array(
    z.object({
      name: z.string().min(1),
      domain: z.string().min(1).optional(),
      type: conceptCandidateType.catch('term'),
      shortDefinition: z.string().min(1).optional(),
      sourceBlockIds: z.array(z.string()).default([]),
      importance: conceptImportance.catch('medium'),
      suggestedCognitiveState: suggestedCognitiveState.catch('Seen'),
      relationships: z
        .array(
          z.object({
            type: z.string().min(1),
            targetName: z.string().min(1),
            rationale: z.string().min(1).optional(),
          }),
        )
        .default([]),
    }),
  ),
})

export type GeneratedCalloutsLlm = z.infer<typeof GeneratedCalloutsLlmSchema>

export const ComparisonTablesLlmSchema = z.object({
  tables: z.array(
    z.object({
      title: z.string().min(1),
      columns: z.array(z.string().min(1)).min(2),
      rows: z.array(
        z.object({
          cells: z
            .array(
              z.object({
                text: z.string().min(1),
                sourceBlockIds: z.array(z.string()).default([]),
              }),
            )
            .min(1),
          sourceBlockIds: z.array(z.string()).default([]),
        }),
      ),
      relatedSectionIds: z.array(z.string()).default([]),
      fidelityRisk: fidelityRisk.default('medium'),
    }),
  ),
})

export type ComparisonTablesLlm = z.infer<typeof ComparisonTablesLlmSchema>

export type ArticleConceptExtractionLlm = z.infer<
  typeof ArticleConceptExtractionLlmSchema
>

// --- Learning-first article outline (DET-348) ------------------------------
//
// What the OUTLINE LLM returns. The stage organises a LEARNING structure (a
// teaching arc, concept-led sections, source furniture demoted to notes) over the
// classified blocks + derived segments, then the rewrite stage writes prose against
// it. Like the other lanes the wire schema is deliberately LENIENT on traceability
// arrays (`sourceBlockIds`/`sourceSegmentIds` default to []), because the SERVICE
// does the strict work in code: it prunes ids the source can't back, drops a
// section/note/callout/table left with no real provenance, then re-checks every
// surviving id (loud failure on an unknown id, exactly like the structure-model and
// plan stages). `sourceKind` / `articleShape` are set in code (derived
// deterministically + passed in), never trusted from the model, so they are absent
// here. The canonical `LearningOutline` type lives in learning-outline.types.ts;
// this is only the model's reply shape.

const learningSectionRole = z.enum([
  'introduction',
  'concept',
  'background',
  'practice',
  'summary',
  'sourceNotes',
  'definition',
  'boundaries',
  'types',
  'mechanism',
  'example',
  'application',
  'misconception',
  'question',
  'method',
  'evidence',
  'results',
  'limitations',
  'implications',
])

const segmentKindSchema = z.enum([
  'content',
  'references',
  'bibliography',
  'externalLinks',
  'furtherReading',
  'citations',
  'seeAlso',
  'footer',
  'noise',
])

const outlineSection = z
  .object({
    heading: z.string().min(1),
    headingSource: planHeadingSource,
    headingInferenceReason: z.string().min(1).optional(),
    sectionRole: learningSectionRole,
    sourceSegmentIds: z.array(z.string()).default([]),
    sourceBlockIds: z.array(z.string()).default([]),
    conceptFocus: z.string().min(1),
    requiredClaims: z.array(z.string().min(1)).default([]),
    targetReaderOutcome: z.string().min(1),
  })
  .refine((s) => s.headingSource !== 'inferred' || !!s.headingInferenceReason, {
    message: 'an inferred heading must carry a headingInferenceReason',
    path: ['headingInferenceReason'],
  })

const learningPathItem = z.object({
  step: z.number().int().min(1),
  outcome: z.string().min(1),
  sectionHeadings: z.array(z.string().min(1)).default([]),
})

const sourceNoteWire = z.object({
  kind: segmentKindSchema,
  sourceBlockIds: z.array(z.string()).default([]),
  sourceSegmentIds: z.array(z.string()).default([]),
  reason: z.string().min(1),
})

const calloutPlanWire = z.object({
  kind: z.enum(['definition', 'example', 'caveat', 'keyIdea', 'misconception']),
  text: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
  sectionHeading: z.string().min(1).optional(),
})

const tablePlanWire = z.object({
  caption: z.string().min(1).optional(),
  sourceBlockIds: z.array(z.string()).default([]),
  sectionHeading: z.string().min(1).optional(),
  reason: z.string().min(1),
})

export const LearningOutlineLlmSchema = z.object({
  title: z.object({ text: z.string().min(1), source: planHeadingSource }),
  dek: z.string().min(1).optional(),
  learningPath: z.array(learningPathItem).default([]),
  sections: z.array(outlineSection).min(1),
  sourceNotesPlan: z
    .object({ notes: z.array(sourceNoteWire).default([]) })
    .default({ notes: [] }),
  calloutPlan: z.array(calloutPlanWire).default([]),
  tablePlan: z.array(tablePlanWire).default([]),
  reorderings: z.array(reorderingAudit).default([]),
  warnings: z.array(z.string().min(1)).default([]),
})

export type LearningOutlineLlm = z.infer<typeof LearningOutlineLlmSchema>
