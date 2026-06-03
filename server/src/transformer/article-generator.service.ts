import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildArticlePrompt } from './article-generator.prompt'
import { completeJson } from './llm-json.util'
import type { ReshapingPlan } from './schemas'
import { ArticleSchema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { SourcePreservingArticle } from './transformer.types'

/** Max chars of a block shown in the originalStructure preview. */
const PREVIEW_CHARS = 120

/**
 * Article-generator service (DET-253, step 8). LLM via
 * `completeJson(ArticleSchema)`, then CODE post-processing:
 *  - `originalStructure` is re-derived deterministically from the blocks
 *    (blockId, blockType, ≤120-char preview) — never trusted from the model.
 *  - every cited block id (paragraphs, sections, abstract, keyTerms, examples,
 *    caveats, subtitle) must exist; an unknown id throws → article FAILED.
 */
@Injectable()
export class ArticleGeneratorService {
  constructor(private readonly ai: AiService) {}

  async generate(
    plan: ReshapingPlan,
    blocks: ClassifiedBlockInput[],
  ): Promise<SourcePreservingArticle> {
    const known = new Set(blocks.map((b) => b.id))
    const content = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        id: b.id,
        type: b.type,
        classification: b.classification,
        text: b.text,
      }))

    const { system, prompt } = buildArticlePrompt(JSON.stringify(plan), content)
    const article = await completeJson(this.ai, {
      system,
      prompt,
      schema: ArticleSchema,
      maxTokens: 8000,
    })

    assertKnownIds(article, known)

    // Re-derive the outline reference deterministically (kept-blocks only, in
    // source order) rather than trusting the model.
    const originalStructure = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        blockId: b.id,
        blockType: b.type,
        preview: b.text.slice(0, PREVIEW_CHARS),
      }))

    return { ...article, originalStructure }
  }
}

/** Every cited block id must reference a real source block, else throw (FAILED). */
function assertKnownIds(
  article: SourcePreservingArticle,
  known: ReadonlySet<string>,
): void {
  const unknown = new Set<string>()
  const check = (ids: string[]) => {
    for (const id of ids) if (!known.has(id)) unknown.add(id)
  }

  if (article.subtitle) check(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) check(p.sourceBlockIds)
  for (const s of article.sections) {
    check(s.sourceBlockIds)
    for (const p of s.paragraphs) check(p.sourceBlockIds)
  }
  for (const t of article.keyTerms) check(t.sourceBlockIds)
  for (const e of article.sourceExamples) check(e.sourceBlockIds)
  for (const c of article.caveats) check(c.sourceBlockIds)

  if (unknown.size > 0) {
    throw new Error(
      `Article references unknown block ids: ${[...unknown].join(', ')}`,
    )
  }
}
