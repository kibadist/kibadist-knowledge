import { TransformerBlockType } from '@kibadist/prisma'

import {
  blocksToPlainText,
  type SourceBlock,
  type SourceDocument,
} from '../source-document/source-document'
import type { PdfPageBlocks } from './pdf-pages.util'

/**
 * Segmentation (DET-249): map an extracted SourceDocument (text/URL) or per-page
 * PDF blocks into ordered, located TransformerSourceBlock rows. Deterministic,
 * unit-tested, ZERO AI.
 *
 * Two invariants the spec pins here:
 *  - `extractedText` is built BY JOINING the final block texts with "\n\n"
 *    (the canonical flat text). charStart/charEnd are computed DURING that join,
 *    so offsets are exact by construction — they always index back into the
 *    string we return.
 *  - Block type mapping (spec §Pipeline 3): heading→HEADING, paragraph→PARAGRAPH,
 *    quote→QUOTE, list→LIST, code→CODE, table→TABLE, image→CAPTION when it has
 *    alt/caption text else DROPPED (not stored), anything else→UNKNOWN.
 */

const BLOCK_SEPARATOR = '\n\n'

/** One segmented block, ready to persist as a TransformerSourceBlock row. */
export interface SegmentedBlock {
  orderIndex: number
  blockType: TransformerBlockType
  text: string
  pageNumber: number | null
  charStart: number
  charEnd: number
}

export interface SegmentedSource {
  blocks: SegmentedBlock[]
  /** Canonical flat text: the block texts joined with "\n\n". */
  extractedText: string
}

/** A source block paired with the page it came from (PDF) or null (text/URL). */
interface LocatedBlock {
  block: SourceBlock
  pageNumber: number | null
}

/** Segment a single-document source (pasted text or a fetched URL). */
export function segmentDocument(doc: SourceDocument): SegmentedSource {
  return segmentLocatedBlocks(
    doc.blocks.map((block) => ({ block, pageNumber: null })),
  )
}

/** Segment a PDF's per-page blocks, preserving page numbers on each block. */
export function segmentPdfPages(pages: PdfPageBlocks[]): SegmentedSource {
  const located: LocatedBlock[] = []
  for (const page of pages) {
    for (const block of page.blocks) {
      located.push({ block, pageNumber: page.pageNumber })
    }
  }
  return segmentLocatedBlocks(located)
}

function segmentLocatedBlocks(located: LocatedBlock[]): SegmentedSource {
  const blocks: SegmentedBlock[] = []
  let cursor = 0
  let extractedText = ''

  for (const { block, pageNumber } of located) {
    const mapped = mapBlock(block)
    // image→CAPTION only when it carries alt/caption text; otherwise dropped
    // (not stored), so its order index is never allocated. Also drop any block
    // that flattened to empty text.
    if (!mapped) continue
    const { blockType, text } = mapped
    if (!text) continue

    // Separator precedes every block after the first; charStart/charEnd index
    // into the SAME string we accumulate, so offsets are exact by construction.
    if (blocks.length > 0) {
      extractedText += BLOCK_SEPARATOR
      cursor += BLOCK_SEPARATOR.length
    }
    const charStart = cursor
    extractedText += text
    cursor += text.length
    const charEnd = cursor

    blocks.push({
      orderIndex: blocks.length,
      blockType,
      text,
      pageNumber,
      charStart,
      charEnd,
    })
  }

  return { blocks, extractedText }
}

/**
 * Map a structured SourceBlock to a transformer block type + its flat text.
 * Returns null when the block should be DROPPED (a captionless image, or a block
 * whose flattened text is empty).
 */
function mapBlock(
  block: SourceBlock,
): { blockType: TransformerBlockType; text: string } | null {
  switch (block.type) {
    case 'heading':
      return finalize(TransformerBlockType.HEADING, blockText(block))
    case 'paragraph':
      return finalize(TransformerBlockType.PARAGRAPH, blockText(block))
    case 'quote':
      return finalize(TransformerBlockType.QUOTE, blockText(block))
    case 'list':
      return finalize(TransformerBlockType.LIST, blockText(block))
    case 'code':
      return finalize(TransformerBlockType.CODE, blockText(block))
    case 'table':
      return finalize(TransformerBlockType.TABLE, blockText(block))
    case 'image': {
      // image→CAPTION only when alt/caption text exists; otherwise drop.
      const caption = block.caption?.trim() || block.alt?.trim() || ''
      if (!caption) return null
      return finalize(TransformerBlockType.CAPTION, caption)
    }
    default:
      // Exhaustiveness guard: any future block type is UNKNOWN, never dropped.
      return finalize(TransformerBlockType.UNKNOWN, blockText(block))
  }
}

function finalize(
  blockType: TransformerBlockType,
  text: string,
): { blockType: TransformerBlockType; text: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return { blockType, text: trimmed }
}

/** Flatten one block to plain text via the shared blocksToPlainText helper. */
function blockText(block: SourceBlock): string {
  return blocksToPlainText([block])
}
