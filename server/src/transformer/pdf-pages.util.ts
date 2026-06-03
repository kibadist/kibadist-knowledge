import {
  extractPdfDocument,
  type SourceBlock,
} from '../source-document/source-document'

/**
 * Per-page PDF extraction (DET-248/257).
 *
 * The inbox PDF util (`pdf-extract.util.ts`) uses `unpdf` with
 * `mergePages:true`, which DISCARDS page boundaries — fine for the inbox, but
 * the transformer needs page numbers so a paragraph can be located back to its
 * page in the source inspector. So this is a NEW util (the inbox one is left
 * untouched): `unpdf` with `mergePages:false` → per-page text → per-page blocks
 * (reusing the existing `pdf-paragraph@1` segmenter), each carrying its
 * 1-based `pageNumber`.
 *
 * No AI, no summarizing (DET-248 zero-AI acceptance). The page text is segmented
 * by the same deterministic paragraph splitter the inbox PDF path uses.
 */

/** Blocks from one page of a PDF, tagged with the page they came from. */
export interface PdfPageBlocks {
  /** 1-based page number. */
  pageNumber: number
  blocks: SourceBlock[]
}

export interface PdfExtraction {
  pages: PdfPageBlocks[]
  /** Total pages reported by the PDF (may exceed `pages.length` if a page had
   *  no extractable text). */
  pageCount: number
  /** True when extraction stopped early because the char budget was exhausted. */
  clipped: boolean
}

/**
 * Resource bounds (security review): a 10MB compressed PDF can decompress to
 * tens of thousands of pages / hundreds of MB of text, and extraction runs
 * synchronously in the API process. Reject page bombs outright and stop
 * accumulating text once the budget is spent (surfaced as `clipped` →
 * `metadata.truncated`).
 */
export const MAX_PDF_PAGES = 500
export const MAX_PDF_TEXT_CHARS = 2_000_000

export async function extractPdfPages(buffer: Buffer): Promise<PdfExtraction> {
  // Lazy import: the (sizeable) pdf.js bundle only loads when a PDF is actually
  // processed, mirroring the inbox util.
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  // mergePages:false returns one string per page, in page order.
  const { text, totalPages } = await extractText(pdf, { mergePages: false })
  const pageTexts: string[] = Array.isArray(text) ? text : [text]

  const pageCount = totalPages ?? pageTexts.length
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(
      `PDF has too many pages (${pageCount} > ${MAX_PDF_PAGES} limit)`,
    )
  }

  const pages: PdfPageBlocks[] = []
  let budget = MAX_PDF_TEXT_CHARS
  let clipped = false
  for (let i = 0; i < pageTexts.length; i++) {
    if (budget <= 0) {
      clipped = true
      break
    }
    const normalized = normalizePageText(pageTexts[i] ?? '')
    if (!normalized) continue
    budget -= normalized.length
    // Reuse the established PDF paragraph segmenter (markdown disabled inside).
    const doc = extractPdfDocument(normalized)
    if (doc.blocks.length === 0) continue
    pages.push({ pageNumber: i + 1, blocks: doc.blocks })
  }

  return { pages, pageCount, clipped }
}

/**
 * Normalize one page's raw text the way the inbox PDF util normalizes the whole
 * document: collapse intra-line whitespace but PRESERVE line/paragraph breaks so
 * the paragraph segmenter can split on blank lines.
 */
function normalizePageText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
