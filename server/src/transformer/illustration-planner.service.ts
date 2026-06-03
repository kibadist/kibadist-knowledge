import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildIllustrationPrompt } from './illustration-planner.prompt'
import { completeJson } from './llm-json.util'
import {
  type IllustrationPlan,
  IllustrationPlanLlmSchema,
  type IllustrationSuggestion,
} from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { SourcePreservingArticle } from './transformer.types'

/**
 * Illustration planner (DET-259, step 10, on demand only). LLM via
 * `completeJson(IllustrationPlanLlmSchema)`, then CODE guards:
 *  - drop any suggestion whose sourceBlockIds is empty or references unknown
 *    blocks ("cannot be created without sourceBlockIds").
 *  - force fidelityRisk='high' for source_based_diagram unless EVERY cited block
 *    is classified METHOD (conservative).
 *  - mint a stable id and force approval='pending' for every suggestion.
 * No image generation anywhere.
 */
@Injectable()
export class IllustrationPlannerService {
  constructor(private readonly ai: AiService) {}

  async plan(
    article: SourcePreservingArticle,
    blocks: ClassifiedBlockInput[],
  ): Promise<IllustrationPlan> {
    const byId = new Map(blocks.map((b) => [b.id, b]))
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildIllustrationPrompt(
      JSON.stringify(article),
      content,
    )
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: IllustrationPlanLlmSchema,
      maxTokens: 3000,
    })

    const suggestions: IllustrationSuggestion[] = []
    for (const s of raw.suggestions) {
      const validIds = s.sourceBlockIds.filter((id) => byId.has(id))
      // DET-259: a suggestion without valid source grounding is dropped.
      if (validIds.length === 0) continue

      let fidelityRisk = s.fidelityRisk
      if (s.illustrationType === 'source_based_diagram') {
        const allMethod = validIds.every(
          (id) => byId.get(id)?.classification === 'METHOD',
        )
        // Conservative: a diagram is high risk unless every cited block is METHOD.
        if (!allMethod) fidelityRisk = 'high'
      }

      suggestions.push({
        id: randomUUID(),
        illustrationType: s.illustrationType,
        purpose: s.purpose,
        visualDescription: s.visualDescription,
        caption: s.caption,
        fidelityRisk,
        reason: s.reason,
        sourceBlockIds: validIds,
        approval: 'pending',
      })
    }

    return { suggestions }
  }
}
