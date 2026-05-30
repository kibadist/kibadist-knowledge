/**
 * Readability-based HTML extractor (DET-210, layered-extractor upgrade).
 *
 * The default URL extraction path. Mozilla Readability (the library behind
 * Firefox Reader View) is far better than a hand-rolled heuristic at isolating
 * the main article from real-world page chrome. We run it over the
 * already-fetched HTML, then feed Readability's *clean* article HTML back
 * through {@link extractHtmlDocument} so the established block mapping owns the
 * conversion — that keeps a single XSS boundary (`safeUrl`), one inline-mark
 * mapper, and the stable content-addressed block ids (DET-208/DET-190 depend on
 * those ids surviving re-extraction).
 *
 * Security boundary: jsdom is constructed with its SAFE defaults — scripts are
 * NOT executed and external sub-resources are NOT loaded. We must never pass
 * `runScripts` or `resources: 'usable'` here: this code parses attacker-influenced
 * HTML on the server, and either option would turn that into RCE/SSRF. jsdom
 * makes no network request on its own; the only network fetch already happened
 * in the SSRF-guarded `fetchReadable`.
 *
 * Returns null (rather than throwing) when extraction fails or yields too little
 * content, so the caller can fall back to the dependency-light hand-rolled
 * extractor.
 */
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'

import {
  extractHtmlDocument,
  type HtmlExtractionResult,
} from './html-to-blocks.util'

/** Below this much extracted text we treat Readability as having failed and
 *  fall back, rather than persisting a near-empty "article". */
const MIN_TEXT_CHARS = 200

function clean(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const t = value.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 300) : undefined
}

/** Only hand jsdom an http(s) base URL (for relative link/image resolution).
 *  Anything else → undefined, so jsdom uses its harmless about:blank default. */
function safeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * Extract a structured document from page HTML using Mozilla Readability.
 * @param rawHtml the fetched page HTML (already byte-capped by fetchReadable)
 * @param url     the origin URL — provenance + base for relative URL resolution
 * @returns the extraction result, or null if Readability could not produce a
 *          usable article (caller should fall back to the heuristic extractor)
 */
export function extractReadableDocument(
  rawHtml: string,
  url?: string,
): HtmlExtractionResult | null {
  if (!rawHtml || rawHtml.trim().length === 0) return null

  let title: string | null | undefined
  let byline: string | null | undefined
  let excerpt: string | null | undefined
  let content: string | null | undefined
  try {
    // Swallow jsdom's parse-error/console noise — malformed HTML is expected
    // here and must not crash or spam logs.
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('jsdomError', () => {})
    const dom = new JSDOM(rawHtml, { url: safeBaseUrl(url), virtualConsole })
    const article = new Readability(dom.window.document).parse()
    dom.window.close()
    if (article) {
      title = article.title
      byline = article.byline
      excerpt = article.excerpt
      content = article.content
    }
  } catch {
    return null
  }

  if (!content || content.trim().length === 0) return null

  // Reuse the established HTML→blocks machinery on Readability's clean article
  // HTML: this keeps the safeUrl XSS boundary, inline-mark mapping, and stable
  // block ids identical to the hand-rolled path.
  const { document, text } = extractHtmlDocument(content, url)
  if (document.blocks.length === 0 || text.trim().length < MIN_TEXT_CHARS) {
    return null
  }

  return {
    document: {
      ...document,
      // Readability's metadata beats our title-tag scrape.
      title: clean(title) ?? document.title,
      byline: clean(byline),
      dek: clean(excerpt),
      extractor: 'readability@1',
      degraded: false,
    },
    text,
  }
}
