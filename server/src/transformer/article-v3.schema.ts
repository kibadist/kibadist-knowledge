import { z } from 'zod'

import type {
  ArticleBlock,
  ArticleJsonV3,
  ArticleQualityReportV3,
  ArticleSection,
  CalloutPlacementMap,
  SourceTrace,
} from './article-v3.types'

/**
 * Zod schemas for Article JSON v3 (DET-344) — the Source-Grounded Learning
 * Article contract.
 *
 * These satisfy the TS contracts in `article-v3.types.ts`: the article-level and
 * recursive shapes are annotated `z.ZodType<...>` so a drift from the committed
 * types is a COMPILE error (the same discipline v2 uses in `schemas.ts`). The
 * model is UNTRUSTED: passing these schemas is necessary but not sufficient; the
 * v3 pipeline (a later ticket) re-checks block-id existence in code afterwards.
 *
 * THE TRACEABILITY GATE. Every content item carries a `SourceTrace`. A `grounded`
 * trace MUST cite at least one real source block (`.refine` below); an ungrounded
 * trace (model scaffolding — a synthesised prompt, a connective transition) may
 * carry none. This is the first line of the "every grounded fragment is
 * traceable" invariant.
 */

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

const headingSourceV3 = z.enum(['original', 'cleanedOriginal', 'inferred'])

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

const sourceKind = z.enum([
  'article',
  'webpage',
  'pdf',
  'academic_paper',
  'book_excerpt',
  'documentation',
  'transcript',
  'lecture_notes',
  'plain_text',
  'other',
])

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
 * The v3 traceability primitive. The `.refine` is the core invariant: a grounded
 * item must cite a real source block; an ungrounded item may cite none.
 */
const sourceTrace: z.ZodType<SourceTrace> = z
  .object({
    grounded: z.boolean(),
    sourceBlockIds: z.array(z.string().min(1)),
    transformationType,
    fidelityRisk,
    note: z.string().min(1).optional(),
  })
  .refine((t) => !t.grounded || t.sourceBlockIds.length >= 1, {
    message: 'a grounded sourceTrace must cite at least one source block',
    path: ['sourceBlockIds'],
  })

const articleTitle = z.object({
  text: z.string().min(1),
  source: headingSourceV3,
  sourceTrace: sourceTrace.optional(),
})

const articleParagraph = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  sourceTrace,
})

// --- Section blocks --------------------------------------------------------

const blockBase = { id: z.string().min(1), sourceTrace }

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

const codeBlock = z.object({
  ...blockBase,
  type: z.literal('code'),
  text: z.string().min(1),
  language: z.string().min(1).optional(),
})

const figureBlock = z.object({
  ...blockBase,
  type: z.literal('figure'),
  suggestionId: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
})

const articleBlock: z.ZodType<ArticleBlock> = z.discriminatedUnion('type', [
  paragraphBlock,
  listBlock,
  quoteBlock,
  codeBlock,
  figureBlock,
])

// Sections nest one level; declared via z.lazy so subsections reuse the schema.
const articleSection: z.ZodType<ArticleSection> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    heading: z.string().min(1),
    headingSource: headingSourceV3,
    headingSourceBlockIds: z.array(z.string().min(1)).optional(),
    summary: z.string().min(1).optional(),
    sectionRole: sectionRole.optional(),
    sourceTrace,
    blocks: z.array(articleBlock),
    conceptIds: z.array(z.string().min(1)).optional(),
    claimIds: z.array(z.string().min(1)).optional(),
    subsections: z.array(articleSection).optional(),
  }),
)

// --- Learning + knowledge layers -------------------------------------------

const learningPathItem = z.object({
  id: z.string().min(1),
  order: z.number().int().min(0),
  title: z.string().min(1),
  objective: z.string().min(1),
  sectionId: z.string().min(1).optional(),
  conceptIds: z.array(z.string().min(1)),
  sourceTrace: sourceTrace.optional(),
})

const conceptCandidate = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  definition: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),
  sectionId: z.string().min(1).optional(),
  importance: z.number().min(0).max(1).optional(),
  sourceTrace,
})

const claimCandidate = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  claimType: z
    .enum(['fact', 'opinion', 'prediction', 'definition', 'causal'])
    .optional(),
  sectionId: z.string().min(1).optional(),
  sourceTrace,
})

const terminologyItem = z.object({
  id: z.string().min(1),
  term: z.string().min(1),
  definition: z.string().min(1),
  sourceTrace,
})

const sourceExample = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  label: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
  sourceTrace,
})

const misconceptionCandidate = z.object({
  id: z.string().min(1),
  misconception: z.string().min(1),
  correction: z.string().min(1),
  sectionId: z.string().min(1).optional(),
  sourceTrace,
})

const retrievalPrompt = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  answer: z.string().min(1).optional(),
  conceptIds: z.array(z.string().min(1)).optional(),
  sourceTrace,
})

// --- Callouts / tables / notes / references --------------------------------

const articleCallout = z.object({
  id: z.string().min(1),
  kind: z.enum(['keyTerm', 'example', 'caveat', 'misconception']),
  term: z.string().min(1).optional(),
  text: z.string().min(1),
  placementReason: z.string().min(1),
  sourceTrace,
})

const calloutPlacements: z.ZodType<CalloutPlacementMap> = z.object({
  bySection: z.record(z.string(), z.array(articleCallout)),
  unplaced: z.array(articleCallout),
})

const articleTable = z.object({
  id: z.string().min(1),
  caption: z.string().min(1).optional(),
  header: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())),
  sectionId: z.string().min(1).optional(),
  sourceTrace,
})

const sourceNote = z.object({
  id: z.string().min(1),
  kind: z.enum(['gap', 'ambiguity', 'structural', 'editorial']),
  text: z.string().min(1),
  sourceTrace: sourceTrace.optional(),
})

const sourceReference = z.object({
  id: z.string().min(1),
  citationText: z.string().min(1),
  title: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  sourceTrace: sourceTrace.optional(),
})

// --- Provenance + quality report -------------------------------------------

const provenance = z.object({
  sourceKind,
  generationMode: z.literal('source_grounded_learning_article'),
  sourceId: z.string().min(1).optional(),
  blocksVersion: z.number().int().min(0).optional(),
  model: z.string().min(1).optional(),
  pipelineVersion: z.number().int().min(1),
  generatedAt: z.string().min(1).optional(),
})

const qualityIssue = z.object({
  severity,
  category: z.enum([
    'ungrounded_content',
    'lost_information',
    'added_information',
    'meaning_change',
    'low_concept_coverage',
    'weak_learning_path',
    'other',
  ]),
  description: z.string().min(1),
  articleRef: z.string().min(1).optional(),
  sourceBlockIds: z.array(z.string().min(1)).optional(),
})

const qualityReport: z.ZodType<ArticleQualityReportV3> = z.object({
  groundingScore: z.number().min(0).max(1),
  coverageScore: z.number().min(0).max(1),
  conceptCoverageScore: z.number().min(0).max(1),
  approved: z.boolean(),
  issues: z.array(qualityIssue),
})

/**
 * The full Article JSON v3 contract. Annotated `z.ZodType<ArticleJsonV3>` so it
 * can never drift from the committed type without a compile error.
 */
export const ArticleJsonV3Schema: z.ZodType<ArticleJsonV3> = z.object({
  schemaVersion: z.literal('v3'),
  mode: z.literal('source_grounded_learning_article'),
  sourceKind,
  shape: articleShape,
  title: articleTitle,
  dek: z.string().min(1).optional(),
  abstract: z.array(articleParagraph),
  learningPath: z.array(learningPathItem),
  sections: z.array(articleSection),
  keyConcepts: z.array(conceptCandidate),
  keyClaims: z.array(claimCandidate),
  terminology: z.array(terminologyItem),
  sourceExamples: z.array(sourceExample),
  misconceptionWarnings: z.array(misconceptionCandidate),
  retrievalPrompts: z.array(retrievalPrompt),
  calloutPlacements,
  tables: z.array(articleTable),
  sourceNotes: z.array(sourceNote),
  references: z.array(sourceReference),
  provenance,
  qualityReport,
})

/** True when a stored article JSON is v3 (discriminated on `schemaVersion`). */
export function isArticleV3(json: unknown): json is ArticleJsonV3 {
  return (
    typeof json === 'object' &&
    json !== null &&
    (json as { schemaVersion?: unknown }).schemaVersion === 'v3'
  )
}

/**
 * Validate an UNTRUSTED value as Article JSON v3, throwing a descriptive error on
 * failure (mirrors the "fail loudly" stance of `completeJson`). Use at the
 * generation boundary; the load boundary uses `isArticleV3` for routing.
 */
export function parseArticleV3(json: unknown): ArticleJsonV3 {
  const result = ArticleJsonV3Schema.safeParse(json)
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 8)
      .map(
        (i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`,
      )
      .join('; ')
    throw new Error(`Article JSON v3 failed validation: ${detail}`)
  }
  return result.data
}
