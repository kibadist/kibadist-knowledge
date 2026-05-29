import { BlockIdFactory } from './block-id.util'
import { safeUrl } from './html-to-blocks.util'
import type {
  InlineMark,
  InlineRun,
  SourceBlock,
  SourceDocument,
} from './source-document.types'

/**
 * Plain-text / markdown → structured blocks (DET-210).
 *
 * Used for PASTE capture (`text-markdown@1`) and as the paragraph-segmenter for
 * PDF text (`pdf-paragraph@1`, with markdown parsing disabled since PDF text
 * carries no reliable markdown syntax). It recognizes the markdown a user
 * actually pastes — ATX headings, `-`/`*`/`1.` lists, `>` quotes, fenced code,
 * and `**bold**` / `*italic*` / `` `code` `` / `[text](url)` inline — and never
 * fabricates structure the text doesn't have: unstructured prose becomes
 * paragraphs split on blank lines, not invented headings.
 */

const MAX_BLOCKS = 600
const MAX_TEXT_CHARS = 50_000
/** Per-block text cap. Bounds the inline parser's input so a pathological
 *  paragraph can't drive super-linear regex backtracking (ReDoS) on the
 *  synchronous capture path. */
const MAX_BLOCK_TEXT = 8_000

// --- Inline markdown ---------------------------------------------------------

// Quantifiers are length-bounded (not bare `+`) so the alternation can't
// backtrack quadratically on adversarial input (e.g. many unclosed `[`).
const INLINE_RE =
  /(\[([^\]]{1,500})\]\(([^)\s]{1,2000})\))|(\*\*([^*]{1,500})\*\*)|(__([^_]{1,500})__)|(\*([^*]{1,500})\*)|(_([^_]{1,500})_)|(`([^`]{1,500})`)|(~~([^~]{1,500})~~)/

function parseInlineMarkdown(input: string): InlineRun[] {
  const runs: InlineRun[] = []
  let rest = input
  while (rest.length > 0) {
    const m = rest.match(INLINE_RE)
    if (!m || m.index === undefined) {
      runs.push({ text: rest })
      break
    }
    if (m.index > 0) runs.push({ text: rest.slice(0, m.index) })

    if (m[1]) {
      const href = safeUrl(m[3])
      runs.push(href ? { text: m[2], href } : { text: m[2] })
    } else if (m[4]) runs.push({ text: m[5], marks: ['bold'] })
    else if (m[6]) runs.push({ text: m[7], marks: ['bold'] })
    else if (m[8]) runs.push({ text: m[9], marks: ['italic'] })
    else if (m[10]) runs.push({ text: m[11], marks: ['italic'] })
    else if (m[12]) runs.push({ text: m[13], marks: ['code'] })
    else if (m[14]) runs.push({ text: m[15], marks: ['strikethrough'] })

    rest = rest.slice(m.index + m[0].length)
  }
  return mergeRuns(runs.filter((r) => r.text.length > 0))
}

function mergeRuns(runs: InlineRun[]): InlineRun[] {
  const out: InlineRun[] = []
  for (const r of runs) {
    const prev = out[out.length - 1]
    const same =
      prev &&
      prev.href === r.href &&
      (prev.marks as InlineMark[] | undefined)?.join(',') === r.marks?.join(',')
    if (same) prev.text += r.text
    else out.push({ ...r })
  }
  return out
}

function plainRuns(text: string): InlineRun[] {
  const trimmed = text.trim()
  return trimmed ? [{ text: trimmed }] : []
}

// --- Block segmentation ------------------------------------------------------

export interface TextToBlocksOptions {
  /** Parse markdown structure (headings/lists/quotes/code/inline). When false,
   *  the input is only segmented into paragraphs (used for PDF text). */
  markdown: boolean
}

function buildBlocks(input: string, opts: TextToBlocksOptions): SourceBlock[] {
  const ids = new BlockIdFactory()
  const blocks: SourceBlock[] = []
  let totalText = 0

  const lines = input.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let paragraph: string[] = []

  const full = () => blocks.length >= MAX_BLOCKS || totalText >= MAX_TEXT_CHARS

  const push = (block: SourceBlock, text: string) => {
    if (full() || !text.trim()) return
    blocks.push(block)
    totalText += text.length
  }

  const flushParagraph = () => {
    const text = paragraph
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_BLOCK_TEXT)
    paragraph = []
    if (!text) return
    const runs = opts.markdown ? parseInlineMarkdown(text) : plainRuns(text)
    if (runs.length) {
      push({ id: ids.next('paragraph', text), type: 'paragraph', runs }, text)
    }
  }

  while (i < lines.length && !full()) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      flushParagraph()
      i++
      continue
    }

    if (opts.markdown) {
      // Fenced code block.
      const fence = trimmed.match(/^(```|~~~)(.*)$/)
      if (fence) {
        flushParagraph()
        const lang = fence[2].trim() || undefined
        const body: string[] = []
        i++
        while (i < lines.length && !lines[i].trim().match(/^(```|~~~)\s*$/)) {
          body.push(lines[i])
          i++
        }
        i++ // consume closing fence
        const text = body.join('\n').slice(0, MAX_BLOCK_TEXT)
        if (text.trim()) {
          push(
            { id: ids.next('code', text), type: 'code', text, language: lang },
            text,
          )
        }
        continue
      }

      // ATX heading.
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        flushParagraph()
        const level = heading[1].length
        const text = heading[2].replace(/\s+#+\s*$/, '').trim()
        push(
          { id: ids.next('heading', text), type: 'heading', level, text },
          text,
        )
        i++
        continue
      }

      // Blockquote (consecutive `>` lines).
      if (/^>\s?/.test(trimmed)) {
        flushParagraph()
        const quoteLines: string[] = []
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''))
          i++
        }
        const text = quoteLines.join(' ').trim().slice(0, MAX_BLOCK_TEXT)
        const runs = parseInlineMarkdown(text)
        if (runs.length)
          push({ id: ids.next('quote', text), type: 'quote', runs }, text)
        continue
      }

      // List (consecutive bullet or ordered items).
      const listMatch = trimmed.match(/^([-*+]|\d+[.)])\s+/)
      if (listMatch) {
        flushParagraph()
        const ordered = /\d/.test(listMatch[1])
        const items: InlineRun[][] = []
        const itemRe = /^([-*+]|\d+[.)])\s+(.*)$/
        while (i < lines.length) {
          const m = lines[i].trim().match(itemRe)
          if (!m) break
          const runs = parseInlineMarkdown(m[2].trim().slice(0, MAX_BLOCK_TEXT))
          if (runs.length) items.push(runs)
          i++
        }
        if (items.length) {
          const text = items
            .map((it) => it.map((r) => r.text).join(''))
            .join('\n')
          push(
            { id: ids.next('list', text), type: 'list', ordered, items },
            text,
          )
        }
        continue
      }
    }

    paragraph.push(trimmed)
    i++
  }
  flushParagraph()
  return blocks
}

/** Build a structured document from pasted text (markdown-aware). */
export function extractTextDocument(text: string): SourceDocument {
  const blocks = buildBlocks(text, { markdown: true })
  return {
    version: 1,
    blocks,
    extractor: 'text-markdown@1',
    degraded: false,
  }
}

/** Build a best-effort structured document from PDF-extracted text. PDF text
 *  carries no reliable structure, so this only paragraph-segments and is marked
 *  degraded. */
export function extractPdfDocument(text: string): SourceDocument {
  const blocks = buildBlocks(text, { markdown: false })
  return {
    version: 1,
    blocks,
    extractor: 'pdf-paragraph@1',
    degraded: true,
  }
}
