/**
 * Wikipedia-specific extractor (DET-210, layered-extractor upgrade).
 *
 * Wikipedia articles are not random web pages — treating them like one (even
 * with Readability) mangles math, infoboxes, and tables. MediaWiki exposes an
 * official parse API (`action=parse`) that returns clean, structured article
 * HTML. For wikipedia.org hosts we go straight to it and feed the result
 * through {@link extractHtmlDocument} (same block mapping / XSS boundary / stable
 * ids as every other path).
 *
 * SSRF posture: the API URL is constructed from a hostname we have already
 * proven is under `wikipedia.org` ({@link isWikipediaUrl}); the only
 * user-controlled part is the article title in the query string. We still apply
 * https-only, a request timeout, manual-redirect rejection, and a byte cap. Any
 * failure returns null so the caller falls back to Readability.
 */
import { assertPublicHost } from '../inbox/url-fetch.util'

import {
  extractHtmlDocument,
  type HtmlExtractionResult,
} from './html-to-blocks.util'

const REQUEST_TIMEOUT_MS = 8000
const MAX_BYTES = 4_000_000 // long articles render to a lot of HTML
const MIN_TEXT_CHARS = 200
const USER_AGENT =
  'KibadistKnowledgeBot/1.0 (+inbox capture; raw material, not indexed)'

/** True for `wikipedia.org` and any `*.wikipedia.org` host over http(s). */
export function isWikipediaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    return host === 'wikipedia.org' || host.endsWith('.wikipedia.org')
  } catch {
    return false
  }
}

/** Pull the article title from a Wikipedia URL (`/wiki/<Title>` or `?title=`). */
function articleTitle(u: URL): string | null {
  const wiki = u.pathname.match(/^\/wiki\/(.+)$/)
  if (wiki) {
    try {
      // Wikipedia article paths use underscores for spaces; MediaWiki titles
      // are canonically space-separated, so normalize before querying.
      const t = decodeURIComponent(wiki[1]).replace(/_/g, ' ').trim()
      if (t) return t.slice(0, 300)
    } catch {
      return null
    }
  }
  const param = u.searchParams.get('title')
  if (param) {
    const t = param.trim()
    if (t) return t.slice(0, 300)
  }
  return null
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.length
      if (total > MAX_BYTES) {
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** MediaWiki `action=parse` response under `formatversion=2`, fields we use. */
interface ParseResponse {
  parse?: { title?: string; text?: string }
  error?: { code?: string; info?: string }
}

/**
 * Extract a Wikipedia article via the MediaWiki parse API.
 * @returns the extraction result, or null when this is not an extractable
 *          Wikipedia article URL or the API call fails (caller falls back).
 */
export async function extractWikipediaDocument(
  rawUrl: string,
): Promise<HtmlExtractionResult | null> {
  if (!isWikipediaUrl(rawUrl)) return null

  let origin: URL
  try {
    origin = new URL(rawUrl)
  } catch {
    return null
  }
  const title = articleTitle(origin)
  if (!title) return null

  // Same wikipedia host the user gave us; only the title varies. Force https.
  const api = new URL(`https://${origin.hostname}/w/api.php`)
  api.searchParams.set('action', 'parse')
  api.searchParams.set('page', title)
  api.searchParams.set('prop', 'text')
  api.searchParams.set('formatversion', '2')
  api.searchParams.set('format', 'json')
  api.searchParams.set('redirects', '1')
  api.searchParams.set('disableeditsection', '1')
  api.searchParams.set('disabletoc', '1')

  // Enforce the same SSRF posture as every other user-influenced server fetch:
  // resolve the host and reject private/loopback/reserved IPs. The host is
  // already constrained to *.wikipedia.org, but a hostname string is not proof
  // of a safe target (DNS rebinding, split-horizon records) — so we still check.
  try {
    await assertPublicHost(api.hostname)
  } catch {
    return null
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let body: string
  try {
    const res = await fetch(api, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    })
    if (!res.ok) return null // 3xx (manual) and 4xx/5xx all fail closed
    body = await readCapped(res)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }

  let data: ParseResponse
  try {
    data = JSON.parse(body) as ParseResponse
  } catch {
    return null
  }
  const html = data.parse?.text
  if (!html || typeof html !== 'string') return null

  const { document, text } = extractHtmlDocument(html, rawUrl)
  if (document.blocks.length === 0 || text.trim().length < MIN_TEXT_CHARS) {
    return null
  }

  return {
    document: {
      ...document,
      title: data.parse?.title?.trim().slice(0, 300) || title,
      canonicalUrl: rawUrl,
      extractor: 'mediawiki@1',
      degraded: false,
    },
    text,
  }
}
