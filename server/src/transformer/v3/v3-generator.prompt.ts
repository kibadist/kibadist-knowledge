import type { SourceKind } from './v3-contract'

/**
 * Prompt construction for the v3 source-grounded generator (DET-343). Two prompts —
 * a source-grounded REWRITE and a LEARNING extraction — both over the SAME numbered
 * source blocks. The contract with the model is narrow and repeated in both: write
 * ONLY what the blocks support, and cite the block ids you drew on. Everything else
 * (ids, provenance, grounding, the quality gate) is decided in code, so the prompt's
 * only job is faithful text + honest citations.
 */

export interface V3PromptBlock {
  id: string
  blockType: string
  classification: string | null
  text: string
}

/** A targeted regeneration note fed back into both prompts on a repair pass. */
export interface V3RegenNote {
  instruction: string
}

function renderBlocks(blocks: V3PromptBlock[]): string {
  return blocks
    .map(
      (b) =>
        `[${b.id}] (${b.blockType}${b.classification ? `/${b.classification}` : ''}) ${b.text}`,
    )
    .join('\n')
}

function renderRegen(notes: V3RegenNote[]): string {
  if (notes.length === 0) return ''
  return `\n\nThis is a REPAIR pass. The previous attempt failed the quality gate. Fix specifically:\n${notes
    .map((n) => `- ${n.instruction}`)
    .join('\n')}`
}

const KIND_GUIDANCE: Record<SourceKind, string> = {
  transcript_lesson:
    'This is a spoken lesson transcript. Strip filler and repetition; recover the lesson structure as clean teaching prose. Preserve every concept the instructor taught.',
  structured_web_article:
    'This is a structured article. Keep its conceptual structure; tighten prose and surface the concepts a learner must acquire.',
  research_paper:
    'This is research material. Preserve claims, methods, and findings precisely; do not overstate.',
  documentation:
    'This is reference/documentation material. Preserve definitions and signatures exactly.',
  raw_notes:
    'These are raw notes. Organise them into coherent learning sections without inventing connective claims the notes do not support.',
  unknown:
    'Reorganise the material into clean learning sections, preserving its meaning.',
}

const REWRITE_SYSTEM = `You rewrite source material into a SOURCE-GROUNDED LEARNING ARTICLE.

HARD RULES:
- Write ONLY what the numbered source blocks support. Never add facts, examples, or claims the source does not contain.
- For every paragraph, list the source block ids ("sourceBlockIds") whose content it is built from. A paragraph that is purely your own connective scaffolding (a transition, a framing sentence) may have an empty list — but keep these rare.
- Organise the article into learning-first sections with clear headings. Give each section a sectionRole and, where you can, a one-line targetReaderOutcome.
- The abstract is a short learning-first lede (what the learner will get).
Return JSON only.`

const LEARNING_SYSTEM = `You extract the LEARNING LAYER from source material that has already been rewritten into an article.

HARD RULES:
- Extract ONLY concepts/claims/terms/prompts the source blocks support. Cite the block ids for each.
- keyConcepts: the concepts a learner must acquire. keyClaims: the source's actual assertions (cite the supporting blocks; if the source does NOT support a claim, do not invent it).
- retrievalPrompts: active-recall questions whose answers the cited blocks contain.
- terminology, misconceptionWarnings, sourceExamples, and an ordered learningPath ("what you'll learn") where each step names the section heading it maps to.
Return JSON only.`

export function buildRewritePrompt(
  blocks: V3PromptBlock[],
  sourceKind: SourceKind,
  regenNotes: V3RegenNote[] = [],
): { system: string; prompt: string } {
  return {
    system: REWRITE_SYSTEM,
    prompt: `${KIND_GUIDANCE[sourceKind]}

SOURCE BLOCKS:
${renderBlocks(blocks)}${renderRegen(regenNotes)}`,
  }
}

export function buildLearningPrompt(
  blocks: V3PromptBlock[],
  sourceKind: SourceKind,
  regenNotes: V3RegenNote[] = [],
): { system: string; prompt: string } {
  return {
    system: LEARNING_SYSTEM,
    prompt: `${KIND_GUIDANCE[sourceKind]}

SOURCE BLOCKS:
${renderBlocks(blocks)}${renderRegen(regenNotes)}`,
  }
}
