/**
 * Structured source document module (DET-210). Public surface for the rest of
 * the server: the contract types, the per-source extractors, and helpers that
 * downstream stages (DET-208 Reference Q&A, future DET-190 Compression) use to
 * turn structured blocks into prompt context.
 */

export { type ConceptChunk, chunkDocument } from './chunk-document.util'
export { extractUrlDocument } from './extract-url-document.util'
export {
  blocksToPlainText,
  extractHtmlDocument,
  type HtmlExtractionResult,
} from './html-to-blocks.util'
export { extractReadableDocument } from './readability-extract.util'
export * from './source-document.types'
export { extractPdfDocument, extractTextDocument } from './text-to-blocks.util'
export {
  extractWikipediaDocument,
  isWikipediaUrl,
} from './wikipedia-extract.util'

import type {
  InlineRun,
  SourceBlock,
  SourceDocument,
} from './source-document.types'

/** Narrow an unknown JSON value (Prisma `Json?`) to a SourceDocument, or null. */
export function asSourceDocument(value: unknown): SourceDocument | null {
  if (!value || typeof value !== 'object') return null
  const doc = value as Partial<SourceDocument>
  if (doc.version !== 1 || !Array.isArray(doc.blocks)) return null
  return doc as SourceDocument
}

function runsToText(runs: InlineRun[]): string {
  return runs
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function blockText(block: SourceBlock): string {
  switch (block.type) {
    case 'heading':
      return block.text
    case 'paragraph':
    case 'quote':
      return runsToText(block.runs)
    case 'list':
      return block.items.map((it) => `• ${runsToText(it)}`).join('\n')
    case 'code':
      return block.text
    case 'table':
      return block.rows.map((r) => r.join(' | ')).join('\n')
    case 'image':
      return block.caption ?? block.alt ?? ''
  }
}

export interface BlockContextLine {
  blockId: string
  type: SourceBlock['type']
  text: string
}

/**
 * Flatten a document into block-id-annotated lines for prompt context (DET-208).
 * Each line carries its stable block id so an AI answer can cite specific blocks
 * (`blockId`) rather than re-quoting prose, and the citation can be resolved back
 * to a location in the Reader. Empty blocks (e.g. bare images) are dropped.
 */
export function documentToContextLines(
  doc: SourceDocument,
): BlockContextLine[] {
  const lines: BlockContextLine[] = []
  for (const block of doc.blocks) {
    const text = blockText(block).trim()
    if (text) lines.push({ blockId: block.id, type: block.type, text })
  }
  return lines
}

/** Render block-id-annotated context as a single string for a prompt. */
export function documentToPromptContext(
  doc: SourceDocument,
  maxChars = 6000,
): string {
  let out = ''
  for (const line of documentToContextLines(doc)) {
    const entry = `[${line.blockId}] ${line.text}\n`
    if (out.length + entry.length > maxChars) break
    out += entry
  }
  return out.trim()
}
