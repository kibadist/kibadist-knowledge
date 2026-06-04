import { collectArticleSourceBlockIds } from './article-compat.util'
import type { SourceStructureModel } from './schemas'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleReadingAids,
  ArticleSectionV2,
  TocEntry,
} from './transformer.types'

/**
 * Deterministic reading aids (DET-274). PURE, NO LLM.
 *
 * Three aids, all computed in code from a finished v2 article (+ the source
 * structure model when available):
 *
 *  - TOC: the final heading hierarchy. Top-level sections become entries; one
 *    level of subsections becomes `children`. Deterministic (document order).
 *  - Reading time: word count over the article BODY only — title, subtitle,
 *    abstract, section/subsection headings, and every typed block's text. The
 *    top-level keyTerms / sourceExamples / caveats are counted ONCE (they render
 *    as callouts), and placement metadata is NEVER double-counted.
 *    `originalStructure` previews and provenance/metadata are excluded. 220 wpm,
 *    minimum 1 minute, rounded to the nearest minute.
 *  - Source Highlights: up to 4 preserved CLAIMS from the structure model (those
 *    are already source-validated), chosen in source order and only when all of
 *    a claim's sourceBlockIds are actually represented in the article. When no
 *    usable claim exists, a verbatim/grammar-cleanup section-leading paragraph's
 *    FIRST SENTENCE is used as a fallback; sections whose leading paragraph is
 *    more heavily transformed are skipped. If nothing safe survives, the
 *    `highlights` field is OMITTED (TOC + reading time still ship).
 *
 * INVARIANT: highlights are verbatim/lightly-cleaned preserved fragments with
 * non-empty sourceBlockIds, never newly written. The fidelity checker
 * independently blocks any unsupported highlight.
 */

const WORDS_PER_MINUTE = 220
const MAX_HIGHLIGHTS = 4

/** Count whitespace-delimited words in a string. */
function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/u).length
}

/** Words contributed by a single typed block's rendered text. */
function blockWordCount(block: ArticleBlock): number {
  switch (block.type) {
    case 'paragraph':
    case 'pullQuote':
    case 'code':
      return countWords(block.text)
    case 'quote':
      return (
        countWords(block.text) +
        (block.attribution ? countWords(block.attribution) : 0)
      )
    case 'callout':
      return (
        countWords(block.text) + (block.title ? countWords(block.title) : 0)
      )
    case 'list':
      return block.items.reduce((n, item) => n + countWords(item), 0)
    case 'table':
      return (
        (block.caption ? countWords(block.caption) : 0) +
        (block.header
          ? block.header.reduce((n, cell) => n + countWords(cell), 0)
          : 0) +
        block.rows.reduce(
          (n, row) => n + row.reduce((m, cell) => m + countWords(cell), 0),
          0,
        )
      )
    case 'figureAnchor':
      // Furniture, not body prose; the illustration system owns figures.
      return 0
  }
}

/** Words in a section + its subsections (headings + every block). */
function sectionWordCount(section: ArticleSectionV2): number {
  let n = countWords(section.heading)
  for (const b of section.blocks) n += blockWordCount(b)
  for (const sub of section.subsections ?? []) n += sectionWordCount(sub)
  return n
}

/**
 * Total reading-time word count of the article body. Title + subtitle +
 * abstract + section/subsection headings + every typed block, plus the top-level
 * keyTerms/sourceExamples/caveats counted ONCE (they render as callouts). No
 * placement metadata, no originalStructure previews, no provenance.
 */
function bodyWordCount(article: ArticleJsonV2): number {
  let n = countWords(article.title.text)
  if (article.subtitle) n += countWords(article.subtitle.text)
  for (const p of article.abstract) n += countWords(p.text)
  for (const s of article.sections) n += sectionWordCount(s)
  for (const t of article.keyTerms) n += countWords(t.term)
  for (const e of article.sourceExamples) n += countWords(e.text)
  for (const c of article.caveats) n += countWords(c.text)
  return n
}

/** TOC from the final heading hierarchy (one level of subsection children). */
function buildToc(article: ArticleJsonV2): TocEntry[] {
  return article.sections.map((s) => {
    const entry: TocEntry = {
      sectionId: s.id,
      heading: s.heading,
      headingSource: s.headingSource,
    }
    if (s.subsections && s.subsections.length > 0) {
      entry.children = s.subsections.map((sub) => ({
        sectionId: sub.id,
        heading: sub.heading,
        headingSource: sub.headingSource,
      }))
    }
    return entry
  })
}

/** The article's first section-leading paragraph block, if any. */
function leadingParagraph(section: ArticleSectionV2): ArticleBlock | undefined {
  return section.blocks.find((b) => b.type === 'paragraph')
}

/** Truncate text at its first sentence boundary (verbatim prefix, no rewrite). */
function firstSentence(text: string): string {
  const trimmed = text.trim()
  const match = /^.*?[.!?](?=\s|$)/su.exec(trimmed)
  return (match ? match[0] : trimmed).trim()
}

/**
 * Highlights from the structure model's preserved claims (already source-
 * validated). Pick the first claims in source order whose sourceBlockIds are ALL
 * represented in the finished article, up to MAX_HIGHLIGHTS. Returns the raw
 * claim text + ids verbatim — never rewritten.
 */
function highlightsFromClaims(
  structureModel: SourceStructureModel,
  represented: ReadonlySet<string>,
): { text: string; sourceBlockIds: string[] }[] {
  const out: { text: string; sourceBlockIds: string[] }[] = []
  for (const claim of structureModel.claims) {
    if (out.length >= MAX_HIGHLIGHTS) break
    if (claim.sourceBlockIds.length === 0) continue
    if (!claim.sourceBlockIds.every((id) => represented.has(id))) continue
    out.push({ text: claim.text, sourceBlockIds: [...claim.sourceBlockIds] })
  }
  return out
}

/**
 * Fallback highlights when no usable claim exists: each section's leading
 * paragraph block's FIRST SENTENCE, but ONLY when that block is verbatim or
 * grammar_cleanup (low-risk preserved text) — otherwise the section is skipped.
 * Stays verbatim-source-grounded; capped at MAX_HIGHLIGHTS in document order.
 */
function highlightsFromLeadingParagraphs(
  article: ArticleJsonV2,
): { text: string; sourceBlockIds: string[] }[] {
  const out: { text: string; sourceBlockIds: string[] }[] = []
  for (const section of article.sections) {
    if (out.length >= MAX_HIGHLIGHTS) break
    const lead = leadingParagraph(section)
    if (!lead || lead.type !== 'paragraph') continue
    if (
      lead.transformationType !== 'verbatim' &&
      lead.transformationType !== 'grammar_cleanup'
    )
      continue
    if (lead.sourceBlockIds.length === 0) continue
    const sentence = firstSentence(lead.text)
    if (!sentence) continue
    out.push({ text: sentence, sourceBlockIds: [...lead.sourceBlockIds] })
  }
  return out
}

/**
 * Build deterministic reading aids for a finished v2 article. Returns `undefined`
 * only when the article has no sections AND no body to summarize is unusual —
 * normally TOC + reading time are always present; `highlights` is omitted when
 * no safe source-grounded highlight survives.
 */
export function buildReadingAids(
  article: ArticleJsonV2,
  structureModel: SourceStructureModel | null,
): ArticleReadingAids | undefined {
  const toc = buildToc(article)
  const wordCount = bodyWordCount(article)
  const minutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE))

  const represented = new Set(collectArticleSourceBlockIds(article))
  let highlights = structureModel
    ? highlightsFromClaims(structureModel, represented)
    : []
  if (highlights.length === 0)
    highlights = highlightsFromLeadingParagraphs(article)

  const aids: ArticleReadingAids = { toc, readingTime: { wordCount, minutes } }
  if (highlights.length > 0) aids.highlights = highlights
  return aids
}
