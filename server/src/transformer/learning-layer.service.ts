import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildLearningLayerPrompt } from './learning-layer.prompt'
import { completeJson } from './llm-json.util'
import {
  type LearningConcept,
  type LearningLayer,
  LearningLayerLlmSchema,
  type RetrievalPrompt,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'

/**
 * Learning-layer service (DET-258, step 11, on demand only). LLM via
 * `completeJson(LearningLayerLlmSchema)`, then CODE guards:
 *  - drop any concept/prompt without valid sourceBlockIds (grounding required).
 *  - mint stable ids; force every validationStatus to 'pending'.
 * NEVER writes into articleJson — the caller stores the result only in the
 * dedicated `learningLayer` column.
 */
@Injectable()
export class LearningLayerService {
  constructor(private readonly ai: AiService) {}

  async build(blocks: ClassifiedBlockInput[]): Promise<LearningLayer> {
    const known = new Set(blocks.map((b) => b.id))
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildLearningLayerPrompt(content)
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: LearningLayerLlmSchema,
      maxTokens: 3000,
    })

    const concepts: LearningConcept[] = []
    for (const c of raw.concepts) {
      const validIds = c.sourceBlockIds.filter((id) => known.has(id))
      if (validIds.length === 0) continue
      concepts.push({
        id: randomUUID(),
        label: c.label,
        definition: c.definition,
        sourceBlockIds: validIds,
        validationStatus: 'pending',
      })
    }

    const retrievalPrompts: RetrievalPrompt[] = []
    for (const p of raw.retrievalPrompts) {
      const validIds = p.sourceBlockIds.filter((id) => known.has(id))
      if (validIds.length === 0) continue
      retrievalPrompts.push({
        id: randomUUID(),
        prompt: p.prompt,
        sourceBlockIds: validIds,
      })
    }

    return { concepts, retrievalPrompts }
  }
}
