import { z } from 'zod'

/**
 * Zod schemas for the v3 pipeline's LLM artifacts (DET-343).
 *
 * Same posture as v2 (`schemas.ts`): the model is UNTRUSTED. These schemas are
 * deliberately PERMISSIVE on `sourceBlockIds` (they allow empty arrays) so the
 * ASSEMBLY (`v3-assembly.util.ts`) can re-check every cited id against the real
 * source blocks and stamp grounding/provenance in CODE — rather than the model
 * silently dropping an item to satisfy a non-empty constraint.
 *
 * Code, not the prompt, owns: block ids, `aiAssisted`/`transformationType`
 * (derived from whether the cited blocks exist), claim support (an empty
 * `sourceBlockIds` ⇒ unsupported, which the gate counts), the quality report, the
 * status, and the provenance summary. The LLM only proposes text + which blocks it
 * drew on.
 */

const blockIds = z.array(z.string()).default([])

const llmParagraph = z.object({
  text: z.string().min(1),
  sourceBlockIds: blockIds,
})

const llmSection = z.object({
  heading: z.string().min(1),
  sectionRole: z
    .enum([
      'introduction',
      'definition',
      'boundaries',
      'mechanism',
      'types',
      'example',
      'application',
      'misconception',
      'evidence',
      'method',
      'results',
      'limitations',
      'implications',
      'steps',
      'reference',
      'summary',
    ])
    .optional(),
  conceptFocus: z.array(z.string().min(1)).optional(),
  targetReaderOutcome: z.string().min(1).optional(),
  sourceBlockIds: blockIds,
  paragraphs: z.array(llmParagraph).default([]),
})

/**
 * What the source-grounded REWRITE LLM returns. No ids, no provenance — all
 * code-owned. `title`/`dek` are plain text; `abstract` and section bodies are
 * paragraph lists with the blocks they drew on.
 */
export const V3RewriteLlmSchema = z.object({
  title: z.string().min(1),
  dek: z.string().min(1).optional(),
  abstract: z.array(llmParagraph).default([]),
  sections: z.array(llmSection).default([]),
})

export type V3RewriteLlm = z.infer<typeof V3RewriteLlmSchema>

const llmConcept = z.object({
  name: z.string().min(1),
  type: z
    .enum([
      'core_concept',
      'supporting_concept',
      'term',
      'process',
      'distinction',
      'method',
      'model',
      'misconception',
    ])
    .default('core_concept'),
  shortDefinition: z.string().min(1).optional(),
  importance: z.enum(['high', 'medium', 'low']).default('medium'),
  sourceBlockIds: blockIds,
})

const llmClaim = z.object({
  text: z.string().min(1),
  claimType: z
    .enum([
      'definition',
      'mechanism',
      'distinction',
      'historical_claim',
      'causal_claim',
      'classification',
      'example',
      'caveat',
    ])
    .default('definition'),
  confidence: z.number().min(0).max(1).default(0.6),
  sourceBlockIds: blockIds,
})

const llmTerminology = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  sourceBlockIds: blockIds,
})

const llmRetrievalPrompt = z.object({
  question: z.string().min(1),
  promptType: z
    .enum([
      'definition',
      'mechanism',
      'distinction',
      'sequence',
      'analogy',
      'misconception_repair',
      'transfer',
    ])
    .default('definition'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  relatedConceptNames: z.array(z.string().min(1)).optional(),
  sourceBlockIds: blockIds,
})

const llmMisconception = z.object({
  misconception: z.string().min(1),
  correction: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.6),
  sourceBlockIds: blockIds,
})

const llmExample = z.object({
  text: z.string().min(1),
  sourceBlockIds: blockIds,
})

const llmLearningStep = z.object({
  label: z.string().min(1),
  outcome: z.string().min(1).optional(),
  /** Heading text the model attaches this step to (matched in code). */
  sectionHeading: z.string().optional(),
})

/**
 * What the LEARNING-EXTRACTION LLM returns. Every item's grounding is re-checked in
 * code: a concept/claim/prompt that cites no real block is kept but flagged
 * (claims with no real block become the gate's unsupported signal).
 */
export const V3LearningLlmSchema = z.object({
  learningPath: z.array(llmLearningStep).default([]),
  keyConcepts: z.array(llmConcept).default([]),
  keyClaims: z.array(llmClaim).default([]),
  terminology: z.array(llmTerminology).default([]),
  retrievalPrompts: z.array(llmRetrievalPrompt).default([]),
  misconceptionWarnings: z.array(llmMisconception).default([]),
  sourceExamples: z.array(llmExample).default([]),
})

export type V3LearningLlm = z.infer<typeof V3LearningLlmSchema>
