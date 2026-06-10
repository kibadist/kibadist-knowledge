import { Injectable } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { buildEditorialLayoutPrompt } from './editorial-layout.prompt'
import { completeJson } from './llm-json.util'
import { type EditorialLayoutLlm, EditorialLayoutLlmSchema } from './schemas'
import type {
  ArticleJsonV2,
  ArticleSectionV2,
  EditorialLayout,
} from './transformer.types'

/** A stat band needs at least this many figures to read as a band, not a stray
 *  number — fewer and we omit it. */
const MIN_STATS = 3

/** Keep the band tight; the renderer lays out 3–4 across a span. */
const MAX_STATS = 4

/** Bound generated furniture so a runaway model can't flood the margin. */
const MAX_SUBHEADS = 8
const MAX_MARGINAL_NOTES = 3

/** Per-section facts the sanitizer needs to validate + clamp anchors. */
type SectionInfo = { paragraphCount: number; blockIds: Set<string> }

/**
 * Editorial-layout service (editorial layout lane). Best-effort sibling of
 * enrichment: it asks the model for editorial FURNITURE (kicker, standfirst,
 * sub-heads, one pull-quote, an optional stat band, marginal notes) so a thin
 * source still renders as a full Compendium entry. It NEVER mutates `articleJson`
 * and only references existing section/block ids; the result lives in its own
 * `editorialLayout` column and ungrounded furniture wears the ✦ AI mark.
 *
 * The model is untrusted: it may drift on ids and indices, so the LLM schema is
 * permissive and `sanitizeEditorialLayout` does the strict work in code — drop
 * furniture citing an unknown section/block id, clamp every afterParagraphIndex,
 * omit a sub-3 stat band and any empty field. This lane runs INLINE (before the
 * background illustration pass) so it never emits `figurePlacements` — the web
 * renderer owns figure placement deterministically.
 */
@Injectable()
export class EditorialLayoutService {
  constructor(private readonly ai: AiService) {}

  async build(article: ArticleJsonV2): Promise<EditorialLayout> {
    const { system, prompt } = buildEditorialLayoutPrompt(article)
    const raw = await completeJson(this.ai, {
      system,
      prompt,
      schema: EditorialLayoutLlmSchema,
      maxTokens: 1500,
    })
    return sanitizeEditorialLayout(raw, article)
  }
}

/**
 * Pure post-process from the lenient LLM reply to a clean `EditorialLayout`.
 * Walks the article (sections + one level of subsections) to collect valid
 * section ids, per-section paragraph counts and block ids, then:
 *  - drops any subhead/pullQuote/marginalNote whose sectionId isn't real;
 *  - drops a pullQuote whose blockId is set but doesn't exist in that section;
 *  - clamps every afterParagraphIndex to [0, paragraphCount];
 *  - omits a statBand with fewer than MIN_STATS (clamps to MAX_STATS);
 *  - omits empty arrays / empty object fields;
 *  - NEVER sets figurePlacements (the web owns it).
 * Exported so it can be unit-tested without the network.
 */
export function sanitizeEditorialLayout(
  llm: EditorialLayoutLlm,
  article: ArticleJsonV2,
): EditorialLayout {
  const sections = collectSections(article)
  const out: EditorialLayout = {}

  if (llm.kicker?.text) {
    out.kicker = { text: llm.kicker.text, grounded: !!llm.kicker.grounded }
  }
  if (llm.standfirst?.text) {
    out.standfirst = {
      text: llm.standfirst.text,
      grounded: !!llm.standfirst.grounded,
    }
  }

  const subheads = (llm.subheads ?? [])
    .filter((s) => sections.has(s.sectionId))
    .slice(0, MAX_SUBHEADS)
    .map((s) => ({
      sectionId: s.sectionId,
      afterParagraphIndex: clampAnchor(
        s.afterParagraphIndex,
        sections,
        s.sectionId,
      ),
      text: s.text,
    }))
  if (subheads.length > 0) out.subheads = subheads

  if (llm.pullQuote && sections.has(llm.pullQuote.sectionId)) {
    const section = sections.get(llm.pullQuote.sectionId)
    // Drop a blockId that doesn't exist in the cited section; the quote text
    // still stands (a paraphrased pull-quote carries no blockId).
    const blockId =
      llm.pullQuote.blockId && section?.blockIds.has(llm.pullQuote.blockId)
        ? llm.pullQuote.blockId
        : undefined
    out.pullQuote = {
      sectionId: llm.pullQuote.sectionId,
      ...(blockId ? { blockId } : {}),
      text: llm.pullQuote.text,
      grounded: !!llm.pullQuote.grounded,
    }
  }

  // A stat band only reads as a band with enough figures; below MIN_STATS we omit
  // it rather than render a lone stat.
  const stats = (llm.statBand?.stats ?? []).slice(0, MAX_STATS)
  if (llm.statBand && stats.length >= MIN_STATS) {
    out.statBand = { grounded: !!llm.statBand.grounded, stats }
  }

  const marginalNotes = (llm.marginalNotes ?? [])
    .filter((n) => sections.has(n.sectionId))
    .slice(0, MAX_MARGINAL_NOTES)
    .map((n) => ({
      sectionId: n.sectionId,
      afterParagraphIndex: clampAnchor(
        n.afterParagraphIndex,
        sections,
        n.sectionId,
      ),
      title: n.title,
      text: n.text,
      grounded: !!n.grounded,
    }))
  if (marginalNotes.length > 0) out.marginalNotes = marginalNotes

  return out
}

/** Clamp an anchor to [0, paragraphCount] of its section. */
function clampAnchor(
  index: number,
  sections: Map<string, SectionInfo>,
  sectionId: string,
): number {
  const max = sections.get(sectionId)?.paragraphCount ?? 0
  if (!Number.isFinite(index) || index < 0) return 0
  return Math.min(Math.floor(index), max)
}

/** Walk sections + one level of subsections into id → {paragraphCount, blockIds}. */
function collectSections(article: ArticleJsonV2): Map<string, SectionInfo> {
  const map = new Map<string, SectionInfo>()
  const visit = (section: ArticleSectionV2): void => {
    const blocks = section.blocks ?? []
    map.set(section.id, {
      paragraphCount: blocks.filter((b) => b.type === 'paragraph').length,
      blockIds: new Set(blocks.map((b) => b.id)),
    })
    for (const sub of section.subsections ?? []) visit(sub)
  }
  for (const section of article.sections ?? []) visit(section)
  return map
}
