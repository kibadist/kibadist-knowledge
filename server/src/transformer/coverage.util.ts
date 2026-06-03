import type {
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
 * Deterministic coverage report (DET-255, step 9). Pure function — no LLM. A
 * block is "represented" if it is cited ANYWHERE in the article: any paragraph
 * (abstract or section), subtitle, keyTerm, sourceExample, or caveat. The
 * `paragraphMap` covers the abstract paragraphs plus every section paragraph.
 *
 *   coveragePercent = represented / (total - removed), rounded.
 *
 * `unrepresentedBlockIds` is whatever is left after represented + removed +
 * uncertain are accounted for — the audit of what the article silently dropped.
 */
export function buildCoverageReport(
  article: SourcePreservingArticle,
  blocks: CoverageBlock[],
  removedBlocks: RemovedBlockRef[],
): CoverageReport {
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
  if (article.subtitle) cite(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) cite(p.sourceBlockIds)
  for (const s of article.sections) {
    cite(s.sourceBlockIds)
    for (const p of s.paragraphs) cite(p.sourceBlockIds)
  }
  for (const t of article.keyTerms) cite(t.sourceBlockIds)
  for (const e of article.sourceExamples) cite(e.sourceBlockIds)
  for (const c of article.caveats) cite(c.sourceBlockIds)

  // Unrepresented = everything not represented and not removed.
  const unrepresentedBlockIds = blocks
    .map((b) => b.id)
    .filter((id) => !represented.has(id) && !removedIds.has(id))

  const denominator = total - removedIds.size
  const coveragePercent =
    denominator <= 0 ? 100 : Math.round((represented.size / denominator) * 100)

  // paragraphMap: abstract + all section paragraphs, in template order.
  const paragraphMap: CoverageReport['paragraphMap'] = []
  for (const p of article.abstract) {
    paragraphMap.push({
      paragraphId: p.id,
      sourceBlockIds: p.sourceBlockIds,
      transformationType: p.transformationType,
      fidelityRisk: p.fidelityRisk,
    })
  }
  for (const s of article.sections) {
    for (const p of s.paragraphs) {
      paragraphMap.push({
        paragraphId: p.id,
        sourceBlockIds: p.sourceBlockIds,
        transformationType: p.transformationType,
        fidelityRisk: p.fidelityRisk,
      })
    }
  }

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
