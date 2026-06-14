import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { collectSectionIds, toArticleV2 } from './article-compat.util'
import { buildCalloutPrompt } from './callout-generator.prompt'
import { completeJson } from './llm-json.util'
import { GeneratedCalloutsLlmSchema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type {
  ArticleGeneratedCallout,
  ArticleJsonV2,
  SourcePreservingArticle,
} from './transformer.types'

/**
 * Callout generator (DET-350). LLM via `completeJson(GeneratedCalloutsLlmSchema)`,
 * then CODE guards mirror the illustration planner's "untrusted model" stance:
 *  - drop any callout whose `sourceBlockIds` is empty or references unknown blocks
 *    ("source-grounded or it does not exist") — this is the in-code rejection of
 *    unsupported callouts; the fidelity checker is the second gate.
 *  - clamp `relatedSectionIds` to ids that actually exist in the article.
 *  - mint a stable, deterministic id (`gco-<type>-<index>`); the model never sets it.
 * No callout that requires facts outside the source can survive (an ungrounded one
 * is dropped; an interpretive one keeps its model-or-default fidelityRisk).
 */
@Injectable()
export class CalloutGeneratorService {
  constructor(private readonly ai: AiService) {}

  async generate(
    input: SourcePreservingArticle | ArticleJsonV2,
    blocks: ClassifiedBlockInput[],
  ): Promise<ArticleGeneratedCallout[]> {
    const article = toArticleV2(input)
    const known = new Set(blocks.map((b) => b.id))
    const sectionIds = collectSectionIds(article.sections)
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildCalloutPrompt(
      JSON.stringify(article),
      content,
    )
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: GeneratedCalloutsLlmSchema,
      maxTokens: 2500,
    })

    const callouts: ArticleGeneratedCallout[] = []
    const perType = new Map<string, number>()
    for (const c of raw.callouts) {
      const validIds = c.sourceBlockIds.filter((id) => known.has(id))
      // DET-350: a callout without valid source grounding is rejected here.
      if (validIds.length === 0) continue
      const related = c.relatedSectionIds.filter((id) => sectionIds.has(id))
      const index = perType.get(c.type) ?? 0
      perType.set(c.type, index + 1)
      callouts.push({
        id: `gco-${c.type}-${index}`,
        type: c.type,
        title: c.title,
        body: c.body,
        sourceBlockIds: validIds,
        relatedSectionIds: related,
        fidelityRisk: c.fidelityRisk,
      })
    }
    return callouts
  }
}
