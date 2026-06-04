import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildArticlePrompt } from './article-generator.prompt'
import { completeJson } from './llm-json.util'
import type { ArticleLlmV2, ReshapingPlan } from './schemas'
import { ArticleLlmV2Schema } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleJsonV2, ArticleSectionV2 } from './transformer.types'
import { ARTICLE_SCHEMA_VERSION } from './transformer.types'

/** Max chars of a block shown in the originalStructure preview. */
const PREVIEW_CHARS = 120

/**
 * Article-generator service (DET-253 → v2 typed blocks, DET-271). The LLM emits
 * the v2 article MINUS the code-owned fields via `completeJson(ArticleLlmV2Schema)`,
 * then CODE post-processing:
 *  - every cited block id (paragraphs, lists, quotes, tables, code, callouts,
 *    pull-quotes, sections + subsections, abstract, keyTerms, examples, caveats,
 *    subtitle) must exist; an unknown id throws → article FAILED.
 *  - `originalStructure` is re-derived deterministically from the blocks
 *    (blockId, blockType, ≤120-char preview) — never trusted from the model.
 *  - `schemaVersion: 'v2'` is stamped in code after validation (not prompt-trusted).
 *  - later-wave fields (readingAids/calloutPlacements/shape/reorderings) are never
 *    requested and the LLM schema cannot carry them, so the artifact is clean by
 *    construction.
 */
@Injectable()
export class ArticleGeneratorService {
  constructor(private readonly ai: AiService) {}

  async generate(
    plan: ReshapingPlan,
    blocks: ClassifiedBlockInput[],
  ): Promise<ArticleJsonV2> {
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
    const llm = await completeJson(this.ai, {
      system,
      prompt,
      schema: ArticleLlmV2Schema,
      // Tables/code can be large; give the model headroom over the v1 budget.
      maxTokens: 10000,
    })

    assertKnownIds(llm, known)

    // Re-derive the outline reference deterministically (kept-blocks only, in
    // source order) rather than trusting the model.
    const originalStructure = blocks
      .filter((b) => !b.removable)
      .map((b) => ({
        blockId: b.id,
        blockType: b.type,
        preview: b.text.slice(0, PREVIEW_CHARS),
      }))

    // Stamp the version in code AFTER validation; later-wave fields are never
    // present on the LLM artifact, so the result is a clean native v2 article.
    return {
      schemaVersion: ARTICLE_SCHEMA_VERSION,
      mode: llm.mode,
      title: llm.title,
      ...(llm.subtitle ? { subtitle: llm.subtitle } : {}),
      abstract: llm.abstract,
      sections: llm.sections,
      keyTerms: llm.keyTerms,
      sourceExamples: llm.sourceExamples,
      caveats: llm.caveats,
      originalStructure,
    }
  }
}

/**
 * Every cited block id must reference a real source block, else throw (FAILED).
 * Walks ALL typed block types and nested subsections: each block carries its own
 * sourceBlockIds (a quote's attribution, a table's cells and a list's items are
 * part of that block's content), so the ids live at the block level.
 */
function assertKnownIds(
  article: ArticleLlmV2,
  known: ReadonlySet<string>,
): void {
  const unknown = new Set<string>()
  const check = (ids: string[]) => {
    for (const id of ids) if (!known.has(id)) unknown.add(id)
  }

  const walkSection = (
    s: ArticleLlmV2['sections'][number] | ArticleSectionV2,
  ) => {
    check(s.sourceBlockIds)
    if (s.headingSourceBlockIds) check(s.headingSourceBlockIds)
    for (const b of s.blocks) check(b.sourceBlockIds)
    for (const sub of s.subsections ?? []) walkSection(sub)
  }

  if (article.subtitle) check(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) check(p.sourceBlockIds)
  for (const s of article.sections) walkSection(s)
  for (const t of article.keyTerms) check(t.sourceBlockIds)
  for (const e of article.sourceExamples) check(e.sourceBlockIds)
  for (const c of article.caveats) check(c.sourceBlockIds)

  if (unknown.size > 0) {
    throw new Error(
      `Article references unknown block ids: ${[...unknown].join(', ')}`,
    )
  }
}
