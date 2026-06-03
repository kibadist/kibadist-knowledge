import { z } from 'zod'

import type {
  ArticleParagraph,
  ArticleSection,
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

const planSection = z.object({
  heading: z.string().min(1),
  headingSource,
  sourceBlockIds,
  allowedTransformations: z.array(allowedTransformation),
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
  titleProposal: z.object({ text: z.string().min(1), source: headingSource }),
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
