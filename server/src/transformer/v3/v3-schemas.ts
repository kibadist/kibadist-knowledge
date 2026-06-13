import { z } from 'zod'

/**
 * Zod schemas for the v3 pipeline's LLM artifacts (DET-343).
 *
 * Same posture as v2 (`schemas.ts`): the model is UNTRUSTED. These schemas are
 * deliberately PERMISSIVE on `sourceBlockIds` (they allow empty arrays) so the
 * service can DROP ungrounded items in code — and re-stamp provenance from the
 * real blocks — rather than the model silently omitting an item to satisfy a
 * non-empty constraint. The id/grounding guards live in the SERVICE
 * (`v3-generator.service.ts`), which re-checks every cited id against the real
 * source blocks; passing these schemas is necessary, never sufficient.
 *
 * Code, not the prompt, owns: block ids, `provenance` (derived from whether the
 * cited blocks exist), claim `support` (`grounded` vs `unsupported`), and the
 * provenance summary. The LLM only proposes text + which blocks it drew on.
 */

const fidelityRisk = z.enum(['low', 'medium', 'high'])

/** Loosened block as the rewrite LLM emits it (ids re-checked in code). */
const llmBlock = z.object({
  type: z.enum(['paragraph', 'list', 'callout', 'example', 'definition']),
  text: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
  fidelityRisk: fidelityRisk.default('low'),
  items: z.array(z.string().min(1)).optional(),
})

const llmSection = z.object({
  heading: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
  blocks: z.array(llmBlock).default([]),
})

/**
 * What the source-grounded REWRITE LLM returns. No ids, no provenance, no
 * summary — all code-owned. `title`/`summary` are plain text; the service stamps
 * their provenance from whether they cite real blocks.
 */
export const V3RewriteLlmSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  sections: z.array(llmSection).default([]),
})

export type V3RewriteLlm = z.infer<typeof V3RewriteLlmSchema>

/** Loosened learning-layer items the extraction LLM emits. */
const llmConcept = z.object({
  label: z.string().min(1),
  definition: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
})

const llmClaim = z.object({
  text: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
})

const llmRetrievalPrompt = z.object({
  prompt: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
})

const llmSourceNote = z.object({
  text: z.string().min(1),
  sourceBlockIds: z.array(z.string()).default([]),
})

const llmLearningStep = z.object({
  objective: z.string().min(1),
  /** Heading text or 1-based section index the model attaches this step to. */
  sectionRefs: z.array(z.string()).default([]),
})

/**
 * What the LEARNING-EXTRACTION LLM returns. Every item's grounding is re-checked
 * in code: a concept/claim/prompt/note that cites no real block is either dropped
 * (concepts, prompts, notes — they must be grounded) or marked `unsupported`
 * (claims — an unsupported claim is a SIGNAL the gate acts on, not noise to hide).
 */
export const V3LearningLlmSchema = z.object({
  learningPath: z.array(llmLearningStep).default([]),
  keyConcepts: z.array(llmConcept).default([]),
  keyClaims: z.array(llmClaim).default([]),
  retrievalPrompts: z.array(llmRetrievalPrompt).default([]),
  sourceNotes: z.array(llmSourceNote).default([]),
})

export type V3LearningLlm = z.infer<typeof V3LearningLlmSchema>
