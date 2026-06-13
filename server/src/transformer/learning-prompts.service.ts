import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import {
  buildLearningPromptsPrompt,
  type PromptConceptCandidate,
} from './learning-prompts.prompt'
import { completeJson } from './llm-json.util'
import {
  type LearningConceptCandidate,
  type LearningPromptSet,
  LearningPromptSetLlmSchema,
  type MisconceptionCandidate,
  type RetrievalPromptCandidate,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleBlock, ArticleJsonV2 } from './transformer.types'

/** Everything the learning-prompt stage consumes (DET-353). */
export interface LearningPromptsInput {
  /** The generated v2 article — sections, source examples, callouts. */
  article: ArticleJsonV2
  /** The pinned source blocks: the grounding universe for every prompt. */
  blocks: ClassifiedBlockInput[]
  /** Concept candidates the prompts may link to (may be empty). */
  conceptCandidates: LearningConceptCandidate[]
  /** Key claims from the source structure model (advisory; may be empty). */
  keyClaims: { text: string; sourceBlockIds: string[] }[]
}

/** Keep stored confidence in the documented [0,1] range regardless of LLM drift. */
function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

/** De-duplicate while preserving first-seen order. */
function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

/** Collect every callout block's text from a v2 article (sections + subsections). */
function collectCallouts(article: ArticleJsonV2): string[] {
  const out: string[] = []
  const walkBlocks = (blocks: ArticleBlock[]) => {
    for (const b of blocks) {
      if (b.type === 'callout') {
        out.push(b.title ? `${b.title}: ${b.text}` : b.text)
      }
    }
  }
  const walk = (sections: ArticleJsonV2['sections']) => {
    for (const s of sections) {
      walkBlocks(s.blocks)
      if (s.subsections) walk(s.subsections)
    }
  }
  walk(article.sections)
  return out
}

/**
 * Learning-prompt service (DET-353). Generates AI-suggested active-recall prompts
 * and misconception candidates from source-grounded article content, then applies
 * CODE guards the model is never trusted to honour:
 *  - retrieval prompts: `expectedAnswerSourceBlockIds` is intersected with the real
 *    source blocks; a prompt that grounds in NOTHING is DROPPED (the answer must be
 *    locatable in the source). `relatedConceptCandidateIds` are filtered to the
 *    article's actual candidate ids. Ids are minted; `status` is forced
 *    `ai_suggested` — nothing is scheduled as a permanent card here.
 *  - misconceptions: `sourceBlockIds` is intersected with the real blocks (kept
 *    even when empty — an ungrounded misconception is allowed but stays clearly
 *    AI-suggested), `confidence` is clamped to [0,1], links are filtered, and
 *    `status` is forced `ai_suggested`.
 *
 * The result is a separate study aid — it is NEVER written into `articleJson`; the
 * caller stores it on the dedicated learning-layer record.
 */
@Injectable()
export class LearningPromptsService {
  constructor(private readonly ai: AiService) {}

  async build(input: LearningPromptsInput): Promise<LearningPromptSet> {
    const { article, blocks, conceptCandidates, keyClaims } = input

    const known = new Set(blocks.map((b) => b.id))
    const knownCandidates = new Set(conceptCandidates.map((c) => c.id))

    const promptCandidates: PromptConceptCandidate[] = conceptCandidates.map(
      (c) => ({ id: c.id, label: c.label, definition: c.definition }),
    )

    const { system, prompt } = buildLearningPromptsPrompt({
      blocks: blocks
        .filter((b) => !b.removable)
        .map((b) => ({
          id: b.id,
          type: b.type,
          classification: b.classification,
          text: b.text,
        })),
      conceptCandidates: promptCandidates,
      keyClaims: keyClaims.map((c) => c.text),
      sourceExamples: article.sourceExamples.map((e) => e.text),
      callouts: collectCallouts(article),
    })

    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: LearningPromptSetLlmSchema,
      maxTokens: 4000,
    })

    const retrievalPrompts: RetrievalPromptCandidate[] = []
    for (const p of raw.retrievalPrompts) {
      const expected = unique(
        p.expectedAnswerSourceBlockIds.filter((id) => known.has(id)),
      )
      // The answer must be locatable in the source — drop ungrounded prompts.
      if (expected.length === 0) continue
      retrievalPrompts.push({
        id: randomUUID(),
        question: p.question,
        expectedAnswerSourceBlockIds: expected,
        relatedConceptCandidateIds: unique(
          p.relatedConceptCandidateIds.filter((id) => knownCandidates.has(id)),
        ),
        promptType: p.promptType,
        difficulty: p.difficulty,
        status: 'ai_suggested',
      })
    }

    const misconceptions: MisconceptionCandidate[] = []
    for (const m of raw.misconceptions) {
      // Grounding is OPTIONAL for a misconception (the ticket allows source-
      // grounded OR clearly-AI-suggested); we keep it whatever its grounding and
      // leave `status` ai_suggested so the UI marks it.
      const grounded = unique(m.sourceBlockIds.filter((id) => known.has(id)))
      misconceptions.push({
        id: randomUUID(),
        misconception: m.misconception,
        correction: m.correction,
        sourceBlockIds: grounded,
        relatedConceptCandidateIds: unique(
          m.relatedConceptCandidateIds.filter((id) => knownCandidates.has(id)),
        ),
        confidence: clampConfidence(m.confidence),
        status: 'ai_suggested',
      })
    }

    return { retrievalPrompts, misconceptions }
  }
}
