/**
 * Article-generator COMPLETENESS (DET-252 follow-up, generator side). The planner
 * now accounts for every non-removable block, but the generator condenses when it
 * renders — it omits plan-assigned blocks, so the FINAL article (which is what
 * the coverage gate measures) still drops the long tail. This recovers them.
 *
 * The recovery is a DETERMINISTIC, VERBATIM backstop rather than an LLM pass: it
 * appends the dropped source block's own text as a `verbatim` paragraph to the
 * nearest section. That preserves the substance exactly (zero risk of the
 * `unsupported_claims` / `lost_information` fidelity blockers an LLM rewrite
 * could introduce) and guarantees coverage can never fail on silent omission.
 */
import type {
  ArticleJsonV2,
  ArticleParagraphBlock,
  ArticleSectionV2,
} from './transformer.types'

/** Minimal source-block shape (source order = array order). */
export interface ArticleCoverBlock {
  id: string
  text: string
  removable: boolean
}

/** Every source-block id cited anywhere in the article (mirrors coverage.util). */
function collectRepresented(article: ArticleJsonV2): Set<string> {
  const represented = new Set<string>()
  const cite = (ids: string[]) => {
    for (const id of ids) represented.add(id)
  }
  const citeSection = (s: ArticleSectionV2) => {
    cite(s.sourceBlockIds)
    for (const b of s.blocks) cite(b.sourceBlockIds)
    for (const sub of s.subsections ?? []) citeSection(sub)
  }
  if (article.subtitle) cite(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) cite(p.sourceBlockIds)
  for (const s of article.sections) citeSection(s)
  for (const t of article.keyTerms) cite(t.sourceBlockIds)
  for (const e of article.sourceExamples) cite(e.sourceBlockIds)
  for (const c of article.caveats) cite(c.sourceBlockIds)
  return represented
}

/** Non-removable source blocks the rendered article cites nowhere. */
export function findUncoveredSourceBlocks(
  article: ArticleJsonV2,
  blocks: ArticleCoverBlock[],
): ArticleCoverBlock[] {
  const represented = collectRepresented(article)
  return blocks.filter((b) => !b.removable && !represented.has(b.id))
}

/**
 * Append each uncovered block to the TOP-LEVEL section holding its nearest
 * source-order neighbour, as a `verbatim` paragraph carrying the block's own
 * text. `sourceOrder` is the source-block ids in source order. Guarantees every
 * uncovered block becomes cited, faithfully. Pure (immutable).
 */
export function appendVerbatimCoverage(
  article: ArticleJsonV2,
  uncovered: ArticleCoverBlock[],
  sourceOrder: string[],
): ArticleJsonV2 {
  if (uncovered.length === 0) return article
  const pos = new Map(sourceOrder.map((id, i) => [id, i]))
  const anchors = article.sections.map((s) => sectionSourceIndices(s, pos))
  const additions: ArticleParagraphBlock[][] = article.sections.map(() => [])
  for (const b of uncovered) {
    const idx = pos.get(b.id)
    const target = idx === undefined ? 0 : nearestSection(anchors, idx)
    additions[target].push({
      id: `gen-cover-${b.id}`,
      type: 'paragraph',
      text: b.text,
      sourceBlockIds: [b.id],
      // The block's own source text, unaltered → no fidelity risk.
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    })
  }
  return {
    ...article,
    sections: article.sections.map((s, i) =>
      additions[i].length > 0
        ? { ...s, blocks: [...s.blocks, ...additions[i]] }
        : s,
    ),
  }
}

/** Source-order positions a top-level section anchors (its + nested blocks). */
function sectionSourceIndices(
  section: ArticleSectionV2,
  pos: ReadonlyMap<string, number>,
): number[] {
  const ids = new Set<string>()
  const walk = (s: ArticleSectionV2) => {
    for (const id of s.sourceBlockIds) ids.add(id)
    for (const b of s.blocks) for (const id of b.sourceBlockIds) ids.add(id)
    for (const sub of s.subsections ?? []) walk(sub)
  }
  walk(section)
  return [...ids]
    .map((id) => pos.get(id))
    .filter((i): i is number => i !== undefined)
}

/** Index of the section whose nearest anchored block is closest in source order.
 *  Strict `<` keeps the earliest section on a tie; defaults to 0. */
function nearestSection(anchors: number[][], idx: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  anchors.forEach((indices, si) => {
    for (const ci of indices) {
      const d = Math.abs(ci - idx)
      if (d < bestDist) {
        bestDist = d
        best = si
      }
    }
  })
  return best
}
