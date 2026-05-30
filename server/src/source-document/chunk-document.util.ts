// Semantic chunking (DET-211). Pure, no I/O. A structured article (DET-210) is
// readable but not yet LEARNABLE — it bundles many cognitive objects (sections,
// definitions, examples) into one wall. To support chunking + active recall
// (and avoid the illusion of competence that comes from re-reading a whole
// article), we split the SourceDocument into a small library of section-sized
// chunks the user can study and, later, promote one at a time.
//
// MVP strategy: deterministic segmentation at the document's MAJOR heading level
// (the shallowest heading present). Deeper sub-headings stay within their
// section, so we get coherent chunks rather than one-line fragments. Content
// before the first heading becomes an "Introduction" chunk; a heading-less
// document is a single chunk. AI-assisted semantic chunking can refine this
// later — this gives an honest, predictable baseline.
//
// NOTE: the full DET-211 DoD was unfetchable when this was written (Linear token
// expired); the chunk shape + heading-based segmentation are inferred from the
// ticket's stated intent ("see the article as learnable cognitive objects") and
// flagged for reconciliation against the full spec.

import type { SourceBlock, SourceDocument } from './source-document.types'

/** A section-sized learnable unit carved from a structured article. */
export interface ConceptChunk {
  /** Stable id — the first block's content-addressed id (DET-210), so a chunk
   *  keeps its identity across re-extraction of unchanged content. */
  id: string
  /** The section heading, or a sensible label for the intro / heading-less doc. */
  title: string
  /** The blocks in reading order that make up this chunk. */
  blocks: SourceBlock[]
  /** The block ids in this chunk — for active-recall mapping + DET-208 citations. */
  blockIds: string[]
  /** Rough size, for ordering/affordances (e.g. hiding trivially-short chunks). */
  wordCount: number
}

function blockWordCount(block: SourceBlock): number {
  switch (block.type) {
    case 'heading':
    case 'code':
      return block.text.trim().split(/\s+/).filter(Boolean).length
    case 'paragraph':
    case 'quote':
      return block.runs
        .map((r) => r.text)
        .join(' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    case 'list':
      return block.items
        .flat()
        .map((r) => r.text)
        .join(' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    case 'table':
      return block.rows.flat().join(' ').trim().split(/\s+/).filter(Boolean)
        .length
    case 'image':
      return (block.caption ?? block.alt ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
  }
}

function makeChunk(title: string, blocks: SourceBlock[]): ConceptChunk {
  return {
    id: blocks[0]?.id ?? title,
    title,
    blocks,
    blockIds: blocks.map((b) => b.id),
    wordCount: blocks.reduce((n, b) => n + blockWordCount(b), 0),
  }
}

/**
 * Split a structured document into section-sized concept chunks.
 *
 * - No blocks → no chunks.
 * - No headings → one chunk covering the whole article (titled by the doc title).
 * - Otherwise → one chunk per MAJOR-level heading (the shallowest heading level
 *   in the doc); content before the first major heading is an "Introduction".
 */
export function chunkDocument(doc: SourceDocument): ConceptChunk[] {
  const blocks = doc.blocks
  if (blocks.length === 0) return []

  const headingLevels = blocks
    .filter(
      (b): b is Extract<SourceBlock, { type: 'heading' }> =>
        b.type === 'heading',
    )
    .map((b) => b.level)

  // Heading-less article: a single learnable unit.
  if (headingLevels.length === 0) {
    return [makeChunk(doc.title?.trim() || 'Article', blocks)]
  }

  // Chunk boundaries are the MAJOR (shallowest) headings; deeper sub-headings
  // ride inside their section.
  const majorLevel = Math.min(...headingLevels)

  const chunks: ConceptChunk[] = []
  let current: SourceBlock[] = []
  let currentTitle = 'Introduction'

  const flush = () => {
    if (current.length > 0) chunks.push(makeChunk(currentTitle, current))
  }

  for (const block of blocks) {
    if (block.type === 'heading' && block.level <= majorLevel) {
      flush()
      current = [block]
      currentTitle = block.text.trim() || 'Section'
    } else {
      current.push(block)
    }
  }
  flush()

  return chunks
}
