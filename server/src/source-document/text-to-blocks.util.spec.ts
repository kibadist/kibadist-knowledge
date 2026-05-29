import type {
  CodeBlock,
  HeadingBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
} from './source-document.types'
import { extractPdfDocument, extractTextDocument } from './text-to-blocks.util'

// ---- extractTextDocument – ATX headings -------------------------------------

describe('extractTextDocument – ATX headings', () => {
  it('# Heading becomes a heading block level 1', () => {
    const doc = extractTextDocument('# Heading')
    expect(doc.blocks).toHaveLength(1)
    const b = doc.blocks[0] as HeadingBlock
    expect(b.type).toBe('heading')
    expect(b.level).toBe(1)
    expect(b.text).toBe('Heading')
  })

  it('## H2 becomes a heading block level 2', () => {
    const doc = extractTextDocument('## H2')
    const b = doc.blocks[0] as HeadingBlock
    expect(b.type).toBe('heading')
    expect(b.level).toBe(2)
    expect(b.text).toBe('H2')
  })

  it('### H3 becomes a heading block level 3', () => {
    const doc = extractTextDocument('### Section')
    const b = doc.blocks[0] as HeadingBlock
    expect(b.level).toBe(3)
  })
})

// ---- extractTextDocument – lists --------------------------------------------

describe('extractTextDocument – lists', () => {
  it('- items become an unordered list with ordered:false', () => {
    const doc = extractTextDocument('- a\n- b\n- c')
    expect(doc.blocks).toHaveLength(1)
    const b = doc.blocks[0] as ListBlock
    expect(b.type).toBe('list')
    expect(b.ordered).toBe(false)
    expect(b.items).toHaveLength(3)
    expect(b.items[0][0].text).toBe('a')
    expect(b.items[1][0].text).toBe('b')
    expect(b.items[2][0].text).toBe('c')
  })

  it('1. 2. items become an ordered list with ordered:true', () => {
    const doc = extractTextDocument('1. a\n2. b')
    const b = doc.blocks[0] as ListBlock
    expect(b.type).toBe('list')
    expect(b.ordered).toBe(true)
    expect(b.items).toHaveLength(2)
  })
})

// ---- extractTextDocument – blockquote ---------------------------------------

describe('extractTextDocument – blockquote', () => {
  it('> line becomes a quote block', () => {
    const doc = extractTextDocument('> quoted line')
    expect(doc.blocks).toHaveLength(1)
    const b = doc.blocks[0] as QuoteBlock
    expect(b.type).toBe('quote')
    expect(b.runs.map((r) => r.text).join('')).toContain('quoted line')
  })
})

// ---- extractTextDocument – fenced code --------------------------------------

describe('extractTextDocument – fenced code blocks', () => {
  it('```js fence produces a code block with language js', () => {
    const doc = extractTextDocument('```js\nconst x = 1\n```')
    expect(doc.blocks).toHaveLength(1)
    const b = doc.blocks[0] as CodeBlock
    expect(b.type).toBe('code')
    expect(b.language).toBe('js')
    expect(b.text).toContain('const x = 1')
  })

  it('fence with no language produces a code block with no language', () => {
    const doc = extractTextDocument('```\nsome code\n```')
    const b = doc.blocks[0] as CodeBlock
    expect(b.type).toBe('code')
    expect(b.language).toBeUndefined()
  })
})

// ---- extractTextDocument – inline markdown in paragraphs --------------------

describe('extractTextDocument – inline markdown in paragraphs', () => {
  const input = 'This is **bold** and *italic* and `code` and [t](http://u)'
  let para: ParagraphBlock

  beforeAll(() => {
    const doc = extractTextDocument(input)
    para = doc.blocks[0] as ParagraphBlock
  })

  it('produces a paragraph block', () => {
    expect(para.type).toBe('paragraph')
  })

  it('contains a run with marks:["bold"]', () => {
    const bold = para.runs.find((r) => r.marks?.includes('bold'))
    expect(bold).toBeDefined()
    expect(bold?.text).toBe('bold')
  })

  it('contains a run with marks:["italic"]', () => {
    const italic = para.runs.find((r) => r.marks?.includes('italic'))
    expect(italic).toBeDefined()
    expect(italic?.text).toBe('italic')
  })

  it('contains a run with marks:["code"]', () => {
    const code = para.runs.find((r) => r.marks?.includes('code'))
    expect(code).toBeDefined()
    expect(code?.text).toBe('code')
  })

  it('contains a run with href http://u', () => {
    const link = para.runs.find((r) => r.href === 'http://u')
    expect(link).toBeDefined()
    expect(link?.text).toBe('t')
  })
})

// ---- extractTextDocument – blank-line separation ----------------------------

describe('extractTextDocument – blank-line paragraph separation', () => {
  it('two paragraphs separated by a blank line produce two paragraph blocks', () => {
    const doc = extractTextDocument('First paragraph.\n\nSecond paragraph.')
    const paras = doc.blocks.filter(
      (b) => b.type === 'paragraph',
    ) as ParagraphBlock[]
    expect(paras).toHaveLength(2)
    expect(paras[0].runs[0].text).toContain('First')
    expect(paras[1].runs[0].text).toContain('Second')
  })
})

// ---- extractTextDocument – document metadata --------------------------------

describe('extractTextDocument – document metadata', () => {
  it('extractor is text-markdown@1', () => {
    const doc = extractTextDocument('hello')
    expect(doc.extractor).toBe('text-markdown@1')
  })

  it('degraded is false', () => {
    const doc = extractTextDocument('hello')
    expect(doc.degraded).toBe(false)
  })

  it('version is 1', () => {
    const doc = extractTextDocument('hello')
    expect(doc.version).toBe(1)
  })
})

// ---- extractPdfDocument – no markdown parsing -------------------------------

describe('extractPdfDocument – markdown is NOT parsed', () => {
  it('# not a heading stays as a paragraph block', () => {
    const doc = extractPdfDocument('# not a heading')
    expect(doc.blocks).toHaveLength(1)
    expect(doc.blocks[0].type).toBe('paragraph')
  })

  it('double-newline-separated text produces multiple paragraph blocks', () => {
    const doc = extractPdfDocument('First chunk.\n\nSecond chunk.')
    const paras = doc.blocks.filter((b) => b.type === 'paragraph')
    expect(paras).toHaveLength(2)
  })

  it('extractor is pdf-paragraph@1', () => {
    const doc = extractPdfDocument('some text')
    expect(doc.extractor).toBe('pdf-paragraph@1')
  })

  it('degraded is true', () => {
    const doc = extractPdfDocument('some text')
    expect(doc.degraded).toBe(true)
  })
})

describe('extractTextDocument – ReDoS resistance', () => {
  it('parses a pathological 50k-char paragraph quickly (no catastrophic backtracking)', () => {
    // Many unclosed `[` previously drove super-linear backtracking in the inline
    // regex; bounded quantifiers + per-block text cap keep this fast.
    const start = Date.now()
    const doc = extractTextDocument('['.repeat(50_000))
    // Completes well under Jest's timeout; assert a generous ceiling.
    expect(Date.now() - start).toBeLessThan(1000)
    expect(doc.blocks.length).toBeGreaterThanOrEqual(0)
  })
})
