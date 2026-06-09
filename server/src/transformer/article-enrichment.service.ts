import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildEnrichmentPrompt } from './article-enrichment.prompt'
import { completeJson } from './llm-json.util'
import { type ArticleEnrichment, ArticleEnrichmentSchema } from './schemas'
import type {
  ArticleJsonV2,
  SourcePreservingArticle,
} from './transformer.types'

/** Cap the summary context sent to the model — the subject is identifiable from
 *  the first paragraphs; the rest is wasted tokens. */
const SUMMARY_CHARS = 1200

/** Keep the infobox tight — a few certain facts beat a long shaky list. */
const MAX_KEY_FACTS = 6

/**
 * Article-enrichment service (DET-319). The ONE non-source-grounded stage: it
 * asks the model for brief encyclopedia headword metadata (pronunciation,
 * etymology, classification, infobox key-facts) about the article's SUBJECT,
 * from world knowledge. It is best-effort and bounded — the prompt instructs the
 * model to omit anything uncertain and to return empty for non-encyclopedic
 * material, and the schema clamps `keyFacts` to 6. The result lives in its own
 * column (never `articleJson`) and the UI labels it as AI-added.
 */
@Injectable()
export class ArticleEnrichmentService {
  constructor(private readonly ai: AiService) {}

  async build(
    article: SourcePreservingArticle | ArticleJsonV2,
  ): Promise<ArticleEnrichment> {
    const title =
      typeof article.title === 'string'
        ? article.title
        : (article.title?.text ?? 'this topic')
    const summary = (article.abstract ?? [])
      .map((p) => p.text)
      .join(' ')
      .slice(0, SUMMARY_CHARS)
    const headings = (article.sections ?? [])
      .map((s) => s.heading)
      .filter(Boolean)
      .join('; ')

    const { system, prompt } = buildEnrichmentPrompt(title, summary, headings)
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: ArticleEnrichmentSchema,
      maxTokens: 1200,
    })
    return { ...raw, keyFacts: raw.keyFacts.slice(0, MAX_KEY_FACTS) }
  }
}
