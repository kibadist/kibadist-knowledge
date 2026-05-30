import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { BadRequestException } from '@nestjs/common'
import { Agent, fetch as undiciFetch } from 'undici'

import { MAX_RAW_TEXT_CHARS } from './inbox.constants'

/**
 * Fetches readable text from a user-supplied URL for inbox capture.
 *
 * This is an SSRF-sensitive surface: an authenticated user hands us a URL and
 * we make a server-side request. Defenses applied here:
 *   - http/https only (enforced again after every redirect)
 *   - DNS resolution + rejection of private/loopback/link-local/reserved IPs
 *   - manual redirect handling, re-validating the host at every hop (≤3)
 *   - request timeout + a hard cap on bytes read
 *   - DNS-rebinding closed by PINNING (DET-206): resolvePublicHost validates the
 *     resolved address set and pinnedDispatcher binds the undici socket to
 *     exactly those IPs via connect.lookup, so the host can't re-resolve to a
 *     private IP between the check and the connect. TLS SNI + cert validation
 *     still use the original hostname, so HTTPS identity is preserved.
 *
 * The extracted text is stored verbatim as *raw material* — never summarized,
 * tagged, or linked (DET-187 anti-behaviors).
 */

const REQUEST_TIMEOUT_MS = 8000
const MAX_BYTES = 2_000_000 // 2MB of HTML is plenty for readable-text extraction
const MAX_REDIRECTS = 3
const USER_AGENT =
  'KibadistKnowledgeBot/1.0 (+inbox capture; raw material, not indexed)'

export interface FetchedPage {
  title: string | null
  text: string
  /** Raw (capped) HTML, for structured block extraction (DET-210). Empty when
   *  the response wasn't HTML. */
  html: string
}

function isBlockedV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = p
  if (a === 0 || a === 10 || a === 127) return true // this-host, private, loopback
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 192 && b === 0) return true // 192.0.0.0/24, 192.0.2.0/24 (test-net)
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // 198.51.100.0/24 (test-net)
  if (a === 203 && b === 0) return true // 203.0.113.0/24 (test-net)
  if (a >= 224) return true // multicast (224/4), reserved (240/4), broadcast
  return false
}

/**
 * Reconstruct the embedded IPv4 from an IPv4-mapped/compatible IPv6 address, in
 * either dotted (`::ffff:127.0.0.1`) or hex-compressed (`::ffff:7f00:1`) form.
 * Critical: `new URL()` ALWAYS normalizes the dotted form to the hex form before
 * we ever see the hostname, so the hex case is the one that actually matters.
 */
function embeddedIpv4(low: string): string | null {
  const dotted = low.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) return dotted[1]
  const hex = low.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (hex) {
    const hi = Number.parseInt(hex[1], 16)
    const lo = Number.parseInt(hex[2], 16)
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  return null
}

function isBlockedV6(ip: string): boolean {
  const low = ip.toLowerCase()
  if (low === '::1' || low === '::') return true // loopback, unspecified
  // IPv4-mapped/compatible — validate the embedded v4 in whatever textual form.
  const mapped = embeddedIpv4(low)
  if (mapped) return isBlockedV4(mapped)
  if (low.startsWith('fc') || low.startsWith('fd')) return true // ULA fc00::/7
  if (/^fe[89ab]/.test(low)) return true // link-local fe80::/10
  if (low.startsWith('ff')) return true // multicast ff00::/8
  if (low.startsWith('2002:')) return true // 6to4 (embeds arbitrary v4)
  if (low.startsWith('64:ff9b:')) return true // NAT64 (embeds arbitrary v4)
  // Catch-all for the rest of ::/96 (IPv4-compatible/mapped/reserved). Any
  // `::`-prefixed form `embeddedIpv4` couldn't parse (e.g. `::ffff:1`) is a
  // deprecated/ambiguous address with no legitimate fetch target — block it.
  // Real public IPv6 is global-unicast 2000::/3 and never starts with `::`.
  if (low.startsWith('::')) return true
  return false
}

function isBlockedIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return isBlockedV4(ip)
  if (family === 6) return isBlockedV6(ip)
  return true // not a recognizable IP → refuse
}

/** A resolved, validated address to pin a connection to. */
export interface PinnedAddress {
  address: string
  family: number
}

/**
 * Resolve `hostname`, reject it if it (or any address it resolves to) is a
 * private/loopback/link-local/reserved IP, and RETURN the validated addresses.
 * The returned set is what the caller pins the actual socket to, closing the
 * DNS-rebinding TOCTOU (DET-206): the IP we validated here is the only IP we
 * will connect to, so the name can't re-resolve to a private host between the
 * check and the connect. Throws BadRequestException on an unresolvable or
 * disallowed host.
 */
export async function resolvePublicHost(
  hostname: string,
): Promise<PinnedAddress[]> {
  // Strip IPv6 brackets if present.
  const host = hostname.replace(/^\[|\]$/g, '')
  const literal = isIP(host)
  if (literal) {
    if (isBlockedIp(host)) {
      throw new BadRequestException('URL host is not allowed')
    }
    return [{ address: host, family: literal }]
  }
  let addresses: { address: string; family: number }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new BadRequestException('Could not resolve URL host')
  }
  if (addresses.length === 0) {
    throw new BadRequestException('Could not resolve URL host')
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new BadRequestException('URL host is not allowed')
    }
  }
  return addresses.map((a) => ({ address: a.address, family: a.family }))
}

/**
 * Resolve + validate `hostname`, discarding the addresses. Exported so other
 * server-side fetch paths that don't pin the socket themselves — e.g. the
 * Wikipedia MediaWiki API call (DET-210) — still enforce the same SSRF posture.
 * Throws BadRequestException; callers that prefer to degrade should catch it.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  await resolvePublicHost(hostname)
}

/**
 * Build a one-shot undici dispatcher whose DNS lookup is PINNED to the
 * already-validated addresses (DET-206). The socket can only connect to an IP we
 * checked; TLS SNI and cert validation still use the original hostname (undici
 * sets `servername` from the request URL), so HTTPS identity is preserved.
 */
function pinnedDispatcher(pinned: PinnedAddress[]): Agent {
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        options: { all?: boolean },
        callback: (
          err: Error | null,
          address: string | PinnedAddress[],
          family?: number,
        ) => void,
      ) => {
        if (options?.all) callback(null, pinned)
        else callback(null, pinned[0].address, pinned[0].family)
      },
    },
  })
}

function assertHttpProtocol(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http(s) URLs can be captured')
  }
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

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(input: string): string {
  return input
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (full, code) => {
      const n = Number(code)
      // Guard invalid/out-of-range code points so a malformed entity can't
      // throw a RangeError out of htmlToText (leave it as the literal match).
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : full
    })
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  const title = decodeEntities(m[1]).replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, 200) : null
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_RAW_TEXT_CHARS)
}

/**
 * Turn a failed (non-OK, non-redirect) response into a user-facing message.
 *
 * Many pages can't be captured by URL at all because they sit behind a bot or
 * login challenge — most commonly Cloudflare's interactive JS challenge ("Just
 * a moment…"), which no server-side fetch can clear regardless of headers. We
 * detect that (the `cf-mitigated` response header, or a 401/403/429 status) and
 * steer the user to the Paste capture path instead of surfacing a bare status
 * code. Other failures keep the plain status message.
 */
export function fetchFailureMessage(
  status: number,
  cfMitigated: string | null,
): string {
  const challenged =
    cfMitigated !== null || status === 401 || status === 403 || status === 429
  if (challenged) {
    return "This page is behind a bot or login challenge (e.g. Cloudflare) and can't be captured by its URL. Open it in your browser and paste the text in instead."
  }
  return `URL responded with ${status}`
}

export async function fetchReadable(rawUrl: string): Promise<FetchedPage> {
  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    throw new BadRequestException('Invalid URL')
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertHttpProtocol(current)
    // Resolve + validate, then PIN the socket to exactly those addresses
    // (DET-206) so DNS can't rebind to a private host between check and connect.
    const pinned = await resolvePublicHost(current.hostname)
    const dispatcher = pinnedDispatcher(pinned)
    // Destroy the one-shot dispatcher when the hop ends — AFTER the body is read
    // on success, or before we continue/throw — so the pinned sockets are always
    // torn down exactly once and never leak.
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      let res: Response
      try {
        res = (await undiciFetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
          headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' },
        })) as unknown as Response
      } catch {
        throw new BadRequestException('Could not fetch URL')
      } finally {
        clearTimeout(timer)
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) throw new BadRequestException('Could not fetch URL')
        try {
          current = new URL(location, current)
        } catch {
          throw new BadRequestException('Could not fetch URL')
        }
        continue // re-validate (and re-pin) the new host on the next iteration
      }

      if (!res.ok) {
        throw new BadRequestException(
          fetchFailureMessage(res.status, res.headers.get('cf-mitigated')),
        )
      }

      // Only extract from textual responses; capture is deliberately dumb, but we
      // shouldn't run an HTML stripper over binary (images, PDFs served inline).
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType && !/text\/|\+xml|\/xml|json/i.test(contentType)) {
        throw new BadRequestException('URL did not return readable text')
      }

      const html = await readCapped(res)
      return { title: extractTitle(html), text: htmlToText(html), html }
    } finally {
      void dispatcher.destroy().catch(() => {})
    }
  }

  throw new BadRequestException('Too many redirects')
}
