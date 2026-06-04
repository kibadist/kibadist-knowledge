import { toArticleV2 } from './article-compat.util'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleSectionV2,
  CoverageReport,
  SourcePreservingArticle,
} from './transformer.types'

/** Minimal block shape coverage needs (id + whether it was classified UNCERTAIN). */
export interface CoverageBlock {
  id: string
  uncertain: boolean
}

/** A removed block as recorded by the reshaping plan. */
export interface RemovedBlockRef {
  blockId: string
  reason: string
}

/**
 * Deterministic coverage report (DET-255, step 9; v2 since DET-277). Pure
 * function — no LLM. Accepts either a v1 `SourcePreservingArticle` or a v2
 * `ArticleJsonV2`; v1 input is adapted to v2 first, so the result is identical
 * either way. A block is "represented" if it is cited ANYWHERE in the article:
 * any block (abstract paragraph or section/subsection block), subtitle, keyTerm,
 * sourceExample, or caveat. The `paragraphMap` covers the abstract paragraphs
 * plus every section/subsection block (in document order).
 *
 *   coveragePercent = represented / (total - removed), rounded.
 *
 * `unrepresentedBlockIds` is whatever is left after represented + removed +
 * uncertain are accounted for — the audit of what the article silently dropped.
 */
export function buildCoverageReport(
  input: SourcePreservingArticle | ArticleJsonV2,
  blocks: CoverageBlock[],
  removedBlocks: RemovedBlockRef[],
): CoverageReport {
  const article = toArticleV2(input)
  const total = blocks.length
  const allIds = new Set(blocks.map((b) => b.id))
  const removedIds = new Set(
    removedBlocks.map((r) => r.blockId).filter((id) => allIds.has(id)),
  )
  const uncertainIds = new Set(
    blocks.filter((b) => b.uncertain).map((b) => b.id),
  )

  // Collect every cited block id across the whole article.
  const represented = new Set<string>()
  const cite = (ids: string[]) => {
    for (const id of ids) if (allIds.has(id)) represented.add(id)
  }
  // Walk a section + its subsections, citing section + every block's ids.
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

  // Unrepresented = everything not represented, not removed, and not uncertain.
  // Uncertain blocks get their own bucket (preserved by policy, never removed),
  // so they must not double-count here — the buckets are disjoint and a UI may
  // sum them. Uncertain blocks still count against coveragePercent below: an
  // uncited uncertain block IS a coverage miss.
  const unrepresentedBlockIds = blocks
    .map((b) => b.id)
    .filter(
      (id) =>
        !represented.has(id) && !removedIds.has(id) && !uncertainIds.has(id),
    )

  const denominator = total - removedIds.size
  const coveragePercent =
    denominator <= 0 ? 100 : Math.round((represented.size / denominator) * 100)

  // paragraphMap: abstract paragraphs + every section/subsection block, in
  // document order. Each entry keys on the block id; every block (any type)
  // carries sourceBlockIds/transformationType/fidelityRisk.
  const paragraphMap: CoverageReport['paragraphMap'] = []
  for (const p of article.abstract) {
    paragraphMap.push({
      paragraphId: p.id,
      sourceBlockIds: p.sourceBlockIds,
      transformationType: p.transformationType,
      fidelityRisk: p.fidelityRisk,
    })
  }
  const mapBlock = (b: ArticleBlock) => {
    paragraphMap.push({
      paragraphId: b.id,
      sourceBlockIds: b.sourceBlockIds,
      transformationType: b.transformationType,
      fidelityRisk: b.fidelityRisk,
    })
  }
  const mapSection = (s: ArticleSectionV2) => {
    for (const b of s.blocks) mapBlock(b)
    for (const sub of s.subsections ?? []) mapSection(sub)
  }
  for (const s of article.sections) mapSection(s)

  return {
    totalBlocks: total,
    coveragePercent,
    representedBlockIds: [...represented],
    removedBlocks: removedBlocks.filter((r) => allIds.has(r.blockId)),
    uncertainBlockIds: [...uncertainIds],
    unrepresentedBlockIds,
    paragraphMap,
  }
}
