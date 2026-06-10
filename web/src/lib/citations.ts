import { type ArticleV2, orderedBlocks, orderedSections } from './article-v2'

/**
 * Citation index (DET-318) — a PURE, deterministic numbering of the source
 * passages an article cites. Every article block already carries its provenance
 * in `source_span_ids` (the TransformerSourceBlock id space, pinned to the
 * article's blocksVersion); this module turns that into the reading surface's
 * citation vocabulary:
 *
 *  - each DISTINCT cited source block gets one citation number, assigned in
 *    first-appearance reading order (sections → blocks, by persisted order);
 *  - each article block maps to its deduped, ascending citation numbers, so the
 *    renderer can place superscript markers without re-walking the article.
 *
 * Citations are never fabricated: a block with no `source_span_ids` simply has
 * no entry, and nothing here invents provenance the pipeline didn't persist.
 */
export interface CitationIndex {
  /** Cited source block ids in numbering order — number N is index N-1. */
  orderedSourceIds: string[]
  /** Source block id → its 1-based citation number. */
  numberBySourceId: Map<string, number>
  /** Article block id → deduped ascending citation numbers for its markers. */
  numbersByBlockId: Map<string, number[]>
}

/** A non-block citation anchor (DET-319): an editorial device — e.g. a
 *  definition card — that carries its own provenance. Registered AFTER the
 *  article walk so prose numbering stays stable in reading order. */
export interface CitationExtra {
  id: string
  sourceIds: string[]
}

export function buildCitationIndex(
  article: ArticleV2,
  extras: CitationExtra[] = [],
): CitationIndex {
  const orderedSourceIds: string[] = []
  const numberBySourceId = new Map<string, number>()
  const numbersByBlockId = new Map<string, number[]>()

  const register = (anchorId: string, ids: string[]) => {
    if (ids.length === 0) return
    const numbers = new Set<number>()
    for (const sourceId of ids) {
      let n = numberBySourceId.get(sourceId)
      if (n === undefined) {
        orderedSourceIds.push(sourceId)
        n = orderedSourceIds.length
        numberBySourceId.set(sourceId, n)
      }
      numbers.add(n)
    }
    numbersByBlockId.set(
      anchorId,
      [...numbers].sort((a, b) => a - b),
    )
  }

  for (const section of orderedSections(article)) {
    for (const block of orderedBlocks(section)) {
      register(block.block_id, block.source_span_ids ?? [])
    }
  }
  for (const extra of extras) {
    register(extra.id, extra.sourceIds)
  }

  return { orderedSourceIds, numberBySourceId, numbersByBlockId }
}
