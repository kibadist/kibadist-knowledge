import { z } from 'zod'

import type {
  ArticleCalloutV3,
  ArticleParagraphV3,
  ArticleSectionV3,
  ArticleTableV3,
  SourceTrace,
} from './rewrite.types'

/**
 * Zod schemas for the source-grounded rewrite stage (DET-349).
 *
 * Two layers, mirroring the v2 generator's split:
 *  - The `*Llm*` schemas are the WIRE shape the rewrite model replies in. They are
 *    deliberately LENIENT: `sourceBlockIds` may be empty and `confidence` may be
 *    missing/garbage, because the service DROPS or NORMALIZES those in code rather
 *    than failing the whole article when the model slips. The model never supplies
 *    block ids for the article's own anchors — code mints them.
 *  - The canonical `ArticleSectionV3Schema` (annotated `z.ZodType<ArticleSectionV3>`
 *    so it can't drift from the frozen type) validates the FINAL post-processed
 *    section: there, every paragraph/callout/table carries a NON-EMPTY
 *    `sourceBlockIds` — the traceability invariant the rest of the v3 engine relies
 *    on.
 */

const fidelityRisk = z.enum(['low', 'medium', 'high'])

const headingSourceV3 = z.enum(['original', 'cleanedOriginal', 'inferred'])

const transformationType = z.enum([
  'verbatim',
  'grammar_cleanup',
  'speech_cleanup',
  'source_grounded_rewrite',
  'source_grounded_summary',
  'source_grounded_inference',
  'ai_assisted_scaffold',
])

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

// --- LLM wire schemas (lenient; the service prunes/normalizes in code) ------

/** Loose id list — empties are dropped in code, not rejected. */
const looseBlockIds = z.array(z.string()).default([])

/** A 0–1 self-assessment; the service clamps. Garbage/absent → 0.5 default. */
const looseConfidence = z.number().catch(0.5).default(0.5)

const llmParagraph = z.object({
  text: z.string().min(1),
  sourceBlockIds: looseBlockIds,
  transformationType,
  fidelityRisk,
  confidence: looseConfidence,
})

const llmCallout = z.object({
  calloutType,
  title: z.string().min(1).optional(),
  text: z.string().min(1),
  sourceBlockIds: looseBlockIds,
  fidelityRisk: fidelityRisk.optional(),
  /**
   * The model's own claim that the callout text is lifted from / supported by the
   * source. The service treats `false` as "AI-invented" and drops it in default
   * mode (an ungrounded analogy/example is exactly what DET-349 disallows).
   */
  grounded: z.boolean().catch(true).default(true),
})

const llmTable = z.object({
  caption: z.string().min(1).optional(),
  header: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).default([]),
  sourceBlockIds: looseBlockIds,
  fidelityRisk: fidelityRisk.optional(),
})

/** One rewritten section as the model replies (one level of nesting). */
export const RewriteSectionLlmSchema: z.ZodType<RewriteSectionLlm> = z.lazy(
  () =>
    z.object({
      heading: z.string().min(1),
      headingSource: headingSourceV3,
      paragraphs: z.array(llmParagraph).default([]),
      callouts: z.array(llmCallout).optional(),
      tables: z.array(llmTable).optional(),
      subsections: z.array(RewriteSectionLlmSchema).optional(),
    }),
)

export type LlmParagraph = z.infer<typeof llmParagraph>
export type LlmCallout = z.infer<typeof llmCallout>
export type LlmTable = z.infer<typeof llmTable>

/** A rewritten section as the model replies (no minted ids; loose provenance). */
export interface RewriteSectionLlm {
  heading: string
  headingSource: z.infer<typeof headingSourceV3>
  paragraphs: LlmParagraph[]
  callouts?: LlmCallout[]
  tables?: LlmTable[]
  subsections?: RewriteSectionLlm[]
}

// --- Canonical post-processed schema (strict; non-empty provenance) ---------

const sourceTrace: z.ZodType<SourceTrace> = z.object({
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  transformationType,
  fidelityRisk,
  confidence: z.number().min(0).max(1),
})

const articleParagraphV3: z.ZodType<ArticleParagraphV3> = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  trace: sourceTrace,
})

const articleCalloutV3: z.ZodType<ArticleCalloutV3> = z.object({
  id: z.string().min(1),
  calloutType,
  title: z.string().min(1).optional(),
  text: z.string().min(1),
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  fidelityRisk,
})

const articleTableV3: z.ZodType<ArticleTableV3> = z.object({
  id: z.string().min(1),
  caption: z.string().min(1).optional(),
  header: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())),
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  fidelityRisk,
})

export const ArticleSectionV3Schema: z.ZodType<ArticleSectionV3> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    heading: z.string().min(1),
    headingSource: headingSourceV3,
    sourceBlockIds: z.array(z.string().min(1)).min(1),
    paragraphs: z.array(articleParagraphV3),
    callouts: z.array(articleCalloutV3).optional(),
    tables: z.array(articleTableV3).optional(),
    subsections: z.array(ArticleSectionV3Schema).optional(),
  }),
)
