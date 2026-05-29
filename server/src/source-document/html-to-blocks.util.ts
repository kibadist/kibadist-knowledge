import { BlockIdFactory } from './block-id.util'
import type {
  InlineMark,
  InlineRun,
  SourceBlock,
  SourceDocument,
} from './source-document.types'

/**
 * HTML → structured blocks (DET-210), `html-heuristic@1`.
 *
 * A dependency-light, structure-preserving extractor. It is deliberately NOT a
 * full DOM/Readability stack (the capture path stays slim and pure-JS, like the
 * existing url-fetch util): it drops obvious site chrome, isolates the main
 * article container when present, and maps block-level elements to typed blocks.
 *
 * It favors graceful degradation over completeness — messy markup yields fewer
 * blocks rather than throwing — and never infers meaning (no summarizing or
 * tagging; the DET-187 capture invariant). Nested lists are flattened and table
 * cells are plain text in this MVP; see the contract notes.
 */

/** Output caps so a pathological page can't produce an enormous document. */
const MAX_BLOCKS = 600
const MAX_TEXT_CHARS = 50_000
const MAX_BLOCK_TEXT = 8_000

const VOID_TAGS = new Set([
  'img',
  'br',
  'hr',
  'input',
  'meta',
  'link',
  'source',
  'wbr',
])

const INLINE_MARK_TAGS: Record<string, InlineMark> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  code: 'code',
  s: 'strikethrough',
  del: 'strikethrough',
  strike: 'strikethrough',
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
}

function decodeEntities(input: string): string {
  return input
    .replace(
      /&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo);/g,
      (m) => ENTITIES[m] ?? m,
    )
    .replace(/&#(\d+);/g, (full, code) => {
      const n = Number(code)
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : full
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (full, hex) => {
      const n = Number.parseInt(hex, 16)
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : full
    })
}

// --- Tokenizer ---------------------------------------------------------------

type Token =
  | { kind: 'open'; tag: string; attrs: string }
  | { kind: 'close'; tag: string }
  | { kind: 'void'; tag: string; attrs: string }
  | { kind: 'text'; text: string }

const TOKEN_RE =
  /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>|([^<]+)/g

function tokenize(html: string): Token[] {
  const tokens: Token[] = []
  let match: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(html)) !== null) {
    const [, closeTag, openTag, attrs, text] = match
    if (closeTag) {
      tokens.push({ kind: 'close', tag: closeTag.toLowerCase() })
    } else if (openTag) {
      const tag = openTag.toLowerCase()
      const selfClosed = match[0].endsWith('/>')
      if (VOID_TAGS.has(tag) || selfClosed) {
        tokens.push({ kind: 'void', tag, attrs: attrs ?? '' })
      } else {
        tokens.push({ kind: 'open', tag, attrs: attrs ?? '' })
      }
    } else if (text) {
      tokens.push({ kind: 'text', text })
    }
  }
  return tokens
}

function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = attrs.match(re)
  if (!m) return undefined
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
}

/**
 * Sanitize a URL from untrusted captured source before it becomes a clickable
 * href or an <img src> in the Reader. Allows http(s), mailto, and relative
 * URLs; drops dangerous schemes (javascript:, data:, vbscript:, …) that would
 * otherwise be a stored-XSS sink, since the structured-block renderer emits a
 * plain <a>/<img> (no Lexical sanitizeUrl in that path).
 */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  const trimmed = url.trim()
  if (!trimmed) return undefined
  // Reject embedded control chars: browsers strip TAB/CR/LF (and other control
  // chars) from a URL's scheme before resolving it, so `java\tscript:` would
  // execute as `javascript:`. Legitimate URLs never contain raw control chars.
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return undefined
  // If the URL carries an explicit scheme, it must be allowlisted. Schemeless
  // (relative, protocol-relative, fragment, query) URLs are permitted as-is.
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return undefined
  return trimmed
}

/** Find the index of the close tag matching the open tag at `start`, honoring
 *  nesting. Returns the tokens length if there's no matching close. */
function findClose(tokens: Token[], start: number, tag: string): number {
  let depth = 0
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === 'open' && t.tag === tag) depth++
    else if (t.kind === 'close' && t.tag === tag) {
      depth--
      if (depth === 0) return i
    }
  }
  return tokens.length
}

// --- Inline runs -------------------------------------------------------------

function pushRun(runs: InlineRun[], run: InlineRun): void {
  if (!run.text) return
  const prev = runs[runs.length - 1]
  const sameMarks =
    prev &&
    prev.href === run.href &&
    (prev.marks ?? []).join(',') === (run.marks ?? []).join(',')
  if (sameMarks) prev.text += run.text
  else runs.push(run)
}

/** Parse a slice of tokens into inline runs, tracking active marks and links. */
function parseInline(tokens: Token[]): InlineRun[] {
  const runs: InlineRun[] = []
  const marks: InlineMark[] = []
  let href: string | undefined

  for (const t of tokens) {
    if (t.kind === 'text') {
      const text = decodeEntities(t.text).replace(/\s+/g, ' ')
      pushRun(runs, {
        text,
        marks: marks.length ? [...marks] : undefined,
        href,
      })
    } else if (t.kind === 'void' && t.tag === 'br') {
      pushRun(runs, { text: '\n' })
    } else if (t.kind === 'open') {
      if (t.tag === 'a') href = safeUrl(getAttr(t.attrs, 'href')) || href
      else if (INLINE_MARK_TAGS[t.tag]) marks.push(INLINE_MARK_TAGS[t.tag])
    } else if (t.kind === 'close') {
      if (t.tag === 'a') href = undefined
      else if (INLINE_MARK_TAGS[t.tag]) {
        const idx = marks.lastIndexOf(INLINE_MARK_TAGS[t.tag])
        if (idx !== -1) marks.splice(idx, 1)
      }
    }
  }

  // Trim leading/trailing whitespace-only runs and cap total length.
  return capRuns(trimRuns(runs))
}

function trimRuns(runs: InlineRun[]): InlineRun[] {
  const out = runs
    .map((r) => ({ ...r, text: r.text.replace(/ /g, ' ') }))
    .filter((r) => r.text.length > 0)
  if (out.length) out[0].text = out[0].text.replace(/^\s+/, '')
  if (out.length) {
    const last = out[out.length - 1]
    last.text = last.text.replace(/\s+$/, '')
  }
  return out.filter((r) => r.text.length > 0)
}

function capRuns(runs: InlineRun[]): InlineRun[] {
  let total = 0
  const out: InlineRun[] = []
  for (const r of runs) {
    if (total >= MAX_BLOCK_TEXT) break
    const text = r.text.slice(0, MAX_BLOCK_TEXT - total)
    total += text.length
    out.push({ ...r, text })
  }
  return out
}

function runsText(runs: InlineRun[]): string {
  return runs
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function textOf(tokens: Token[]): string {
  return runsText(parseInline(tokens))
}

// --- Block builder -----------------------------------------------------------

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

class BlockBuilder {
  readonly blocks: SourceBlock[] = []
  private totalText = 0
  private readonly ids = new BlockIdFactory()
  private inlineBuffer: Token[] = []

  private get full(): boolean {
    return this.blocks.length >= MAX_BLOCKS || this.totalText >= MAX_TEXT_CHARS
  }

  private add(
    make: (id: string) => SourceBlock,
    type: SourceBlock['type'],
    text: string,
  ): void {
    if (this.full || !text) return
    this.blocks.push(make(this.ids.next(type, text)))
    this.totalText += text.length
  }

  private flushInline(): void {
    if (this.inlineBuffer.length === 0) return
    const runs = parseInline(this.inlineBuffer)
    this.inlineBuffer = []
    const text = runsText(runs)
    if (text)
      this.add((id) => ({ id, type: 'paragraph', runs }), 'paragraph', text)
  }

  build(tokens: Token[]): SourceBlock[] {
    let i = 0
    while (i < tokens.length && !this.full) {
      const t = tokens[i]
      if (t.kind === 'open' && HEADING_TAGS.has(t.tag)) {
        this.flushInline()
        const end = findClose(tokens, i, t.tag)
        const text = textOf(tokens.slice(i + 1, end))
        const level = Number(t.tag[1])
        this.add(
          (id) => ({ id, type: 'heading', level, text }),
          'heading',
          text,
        )
        i = end + 1
      } else if (t.kind === 'open' && t.tag === 'p') {
        this.flushInline()
        const end = findClose(tokens, i, 'p')
        const runs = parseInline(tokens.slice(i + 1, end))
        const text = runsText(runs)
        if (text)
          this.add((id) => ({ id, type: 'paragraph', runs }), 'paragraph', text)
        i = end + 1
      } else if (t.kind === 'open' && t.tag === 'blockquote') {
        this.flushInline()
        const end = findClose(tokens, i, 'blockquote')
        const runs = parseInline(tokens.slice(i + 1, end))
        const text = runsText(runs)
        if (text) this.add((id) => ({ id, type: 'quote', runs }), 'quote', text)
        i = end + 1
      } else if (t.kind === 'open' && t.tag === 'pre') {
        this.flushInline()
        const end = findClose(tokens, i, 'pre')
        this.addCode(tokens.slice(i + 1, end))
        i = end + 1
      } else if (t.kind === 'open' && (t.tag === 'ul' || t.tag === 'ol')) {
        this.flushInline()
        const end = findClose(tokens, i, t.tag)
        this.addList(tokens.slice(i + 1, end), t.tag === 'ol')
        i = end + 1
      } else if (t.kind === 'open' && t.tag === 'table') {
        this.flushInline()
        const end = findClose(tokens, i, 'table')
        this.addTable(tokens.slice(i + 1, end))
        i = end + 1
      } else if (t.kind === 'open' && t.tag === 'figure') {
        this.flushInline()
        const end = findClose(tokens, i, 'figure')
        this.addFigure(tokens.slice(i + 1, end))
        i = end + 1
      } else if (t.kind === 'void' && t.tag === 'img') {
        this.flushInline()
        this.addImage(t.attrs)
        i++
      } else if (t.kind === 'void' && t.tag === 'hr') {
        this.flushInline()
        i++
      } else {
        // Transparent container/inline token: accumulate into a paragraph.
        this.inlineBuffer.push(t)
        i++
      }
    }
    this.flushInline()
    return this.blocks
  }

  private addCode(tokens: Token[]): void {
    let language: string | undefined
    for (const t of tokens) {
      if ((t.kind === 'open' || t.kind === 'void') && t.tag === 'code') {
        const cls = getAttr(t.attrs, 'class') ?? ''
        const m = cls.match(/(?:language|lang)-([\w+#-]+)/i)
        if (m) language = m[1]
      }
    }
    const text = tokens
      .filter((t): t is Extract<Token, { kind: 'text' }> => t.kind === 'text')
      .map((t) => decodeEntities(t.text))
      .join('')
      .replace(/^\n+|\n+$/g, '')
      .slice(0, MAX_BLOCK_TEXT)
    if (text.trim()) {
      this.add((id) => ({ id, type: 'code', text, language }), 'code', text)
    }
  }

  private addList(tokens: Token[], ordered: boolean): void {
    const items: InlineRun[][] = []
    let i = 0
    while (i < tokens.length) {
      const t = tokens[i]
      if (t.kind === 'open' && t.tag === 'li') {
        const end = findClose(tokens, i, 'li')
        const runs = parseInline(tokens.slice(i + 1, end))
        if (runsText(runs)) items.push(runs)
        i = end + 1
      } else i++
    }
    if (items.length === 0) return
    const text = items.map(runsText).join('\n')
    this.add((id) => ({ id, type: 'list', ordered, items }), 'list', text)
  }

  private addTable(tokens: Token[]): void {
    const rows: string[][] = []
    let headerRow = false
    let i = 0
    while (i < tokens.length) {
      const t = tokens[i]
      if (t.kind === 'open' && t.tag === 'tr') {
        const end = findClose(tokens, i, 'tr')
        const { cells, hasTh } = this.parseRow(tokens.slice(i + 1, end))
        if (cells.length) {
          if (rows.length === 0 && hasTh) headerRow = true
          rows.push(cells)
        }
        i = end + 1
      } else i++
    }
    if (rows.length === 0) return
    const text = rows.map((r) => r.join(' | ')).join('\n')
    this.add(
      (id) => ({ id, type: 'table', header: headerRow, rows }),
      'table',
      text,
    )
  }

  private parseRow(tokens: Token[]): { cells: string[]; hasTh: boolean } {
    const cells: string[] = []
    let hasTh = false
    let i = 0
    while (i < tokens.length) {
      const t = tokens[i]
      if (t.kind === 'open' && (t.tag === 'td' || t.tag === 'th')) {
        if (t.tag === 'th') hasTh = true
        const end = findClose(tokens, i, t.tag)
        cells.push(textOf(tokens.slice(i + 1, end)))
        i = end + 1
      } else i++
    }
    return { cells, hasTh }
  }

  private addFigure(tokens: Token[]): void {
    let caption: string | undefined
    let img: { src: string; alt?: string } | undefined
    let i = 0
    while (i < tokens.length) {
      const t = tokens[i]
      if (t.kind === 'void' && t.tag === 'img' && !img) {
        const src = safeUrl(getAttr(t.attrs, 'src'))
        if (src) img = { src, alt: getAttr(t.attrs, 'alt') }
        i++
      } else if (t.kind === 'open' && t.tag === 'figcaption') {
        const end = findClose(tokens, i, 'figcaption')
        caption = textOf(tokens.slice(i + 1, end)) || undefined
        i = end + 1
      } else i++
    }
    if (img) {
      const text = img.alt || caption || img.src
      this.add(
        (id) => ({ id, type: 'image', src: img.src, alt: img.alt, caption }),
        'image',
        text,
      )
    }
  }

  private addImage(attrs: string): void {
    const src = safeUrl(getAttr(attrs, 'src'))
    if (!src) return
    const alt = getAttr(attrs, 'alt')
    this.add((id) => ({ id, type: 'image', src, alt }), 'image', alt || src)
  }
}

// --- Document assembly -------------------------------------------------------

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    )
}

/** Isolate the main article container, dropping obvious site chrome. */
function isolateMain(html: string): string {
  const article = bestMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/gi)
  if (article) return article
  const main = bestMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/gi)
  if (main) return main
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  const scoped = body ? body[1] : html
  return scoped.replace(
    /<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  )
}

/** Return the longest capture-group match (the meatiest container). */
function bestMatch(html: string, re: RegExp): string | null {
  let best: string | null = null
  let match: RegExpExecArray | null
  re.lastIndex = 0
  while ((match = re.exec(html)) !== null) {
    if (!best || match[1].length > best.length) best = match[1]
  }
  return best && best.trim().length > 0 ? best : null
}

function extractTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (title) {
    const t = decodeEntities(title[1]).replace(/\s+/g, ' ').trim()
    if (t) return t.slice(0, 300)
  }
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) {
    const t = textOf(tokenize(h1[1]))
    if (t) return t.slice(0, 300)
  }
  return undefined
}

export interface HtmlExtractionResult {
  document: SourceDocument
  /** Flattened plain text (provenance/fallback/search), mirroring legacy
   *  behavior so Concept.sourceText stays populated. */
  text: string
}

/**
 * Extract a structured {@link SourceDocument} from a captured HTML page.
 * `canonicalUrl` is the origin URL (provenance). Falls back to an empty block
 * list (degraded) rather than throwing on unparseable input.
 */
export function extractHtmlDocument(
  rawHtml: string,
  canonicalUrl?: string,
): HtmlExtractionResult {
  const cleaned = stripNoise(rawHtml)
  const title = extractTitle(cleaned)
  const main = isolateMain(cleaned)
  const blocks = new BlockBuilder().build(tokenize(main))

  const text = blocksToPlainText(blocks).slice(0, MAX_TEXT_CHARS)
  const document: SourceDocument = {
    version: 1,
    title,
    canonicalUrl,
    blocks,
    extractor: 'html-heuristic@1',
    degraded: blocks.length === 0,
  }
  return { document, text }
}

/** Flatten blocks to readable plain text (paragraph-separated). */
export function blocksToPlainText(blocks: SourceBlock[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        parts.push(b.text)
        break
      case 'paragraph':
      case 'quote':
        parts.push(runsText(b.runs))
        break
      case 'list':
        parts.push(b.items.map((it) => `• ${runsText(it)}`).join('\n'))
        break
      case 'code':
        parts.push(b.text)
        break
      case 'table':
        parts.push(b.rows.map((r) => r.join(' | ')).join('\n'))
        break
      case 'image':
        if (b.caption || b.alt) parts.push(b.caption ?? b.alt ?? '')
        break
    }
  }
  return parts.filter(Boolean).join('\n\n').trim()
}
