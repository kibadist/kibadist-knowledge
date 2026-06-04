import { z } from 'zod'

import type {
  ArticleJsonV2,
  ArticleParagraph,
  ArticleSection,
  ArticleSectionV2,
  FidelityFinding,
  FidelityReport,
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
  sections: z.array(planSection).min(1),
  removedBlocks: z.array(removedBlock),
  warnings: z.array(z.string().min(1)),
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
  'intro',
  'background',
  'body',
  'method',
  'evidence',
  'example',
  'caveat',
  'conclusion',
  'reference',
])

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

const readingAids = z.object({
  toc: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        heading: z.string().min(1),
        level: z.number(),
      }),
    )
    .optional(),
  readingTimeMinutes: z.number().optional(),
  sourceHighlights: z
    .array(z.object({ text: z.string().min(1), sourceBlockIds }))
    .optional(),
})

const calloutPlacement = z.object({
  refId: z.string().min(1),
  sectionId: z.string().min(1),
  placementReason: z.string().min(1),
})

const calloutPlacements = z.object({
  bySection: z.record(z.string(), z.array(calloutPlacement)),
  unplaced: z.array(calloutPlacement),
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

const reorderingAudit = z.object({
  sourceBlockId: z.string().min(1),
  fromIndex: z.number(),
  toIndex: z.number(),
  movedWithClusterIds: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1),
  risk: fidelityRisk,
})

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

export const ArticleJsonV2Schema: z.ZodType<ArticleJsonV2> = z.object({
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
})

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
})

export type RetrievalPrompt = z.infer<typeof retrievalPrompt>

/** Stored learning layer (code-managed ids + validationStatus). */
export const LearningLayerSchema = z.object({
  concepts: z.array(learningConcept),
  retrievalPrompts: z.array(retrievalPrompt),
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
