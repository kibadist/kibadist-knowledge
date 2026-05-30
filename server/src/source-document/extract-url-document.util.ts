/**
 * URL extraction router (DET-210, layered-extractor upgrade).
 *
 * One async entry point for turning a fetched page into a structured
 * {@link SourceDocument}, choosing the best extractor per source:
 *
 *   1. Wikipedia  → MediaWiki parse API (clean structure for math/tables)
 *   2. everything → Mozilla Readability (the default, best-quality reader)
 *   3. fallback   → the dependency-light hand-rolled heuristic extractor
 *
 * Each layer returns null when it can't produce a usable article, so we degrade
 * gracefully instead of persisting an empty document. The hand-rolled extractor
 * is the floor: it never returns null, so this function always resolves.
 */
import {
  extractHtmlDocument,
  type HtmlExtractionResult,
} from './html-to-blocks.util'
import { extractReadableDocument } from './readability-extract.util'
import { extractWikipediaDocument } from './wikipedia-extract.util'

/**
 * Extract a structured document from a captured URL + its fetched HTML.
 * @param url     the (already SSRF-validated) source URL
 * @param rawHtml the page HTML fetched for that URL (byte-capped upstream)
 */
export async function extractUrlDocument(
  url: string,
  rawHtml: string,
): Promise<HtmlExtractionResult> {
  const wiki = await extractWikipediaDocument(url)
  if (wiki) return wiki

  const readable = extractReadableDocument(rawHtml, url)
  if (readable) return readable

  return extractHtmlDocument(rawHtml, url)
}
