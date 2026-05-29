import {
  asSourceDocument,
  documentToContextLines,
  documentToPromptContext,
} from './source-document'
import type { SourceDocument } from './source-document.types'

// ---- asSourceDocument -------------------------------------------------------

describe('asSourceDocument', () => {
  it('returns null for null', () => {
    expect(asSourceDocument(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(asSourceDocument(undefined)).toBeNull()
  })

  it('returns null for a non-object (string)', () => {
    expect(asSourceDocument('hello')).toBeNull()
  })

  it('returns null for a non-object (number)', () => {
    expect(asSourceDocument(42)).toBeNull()
  })

  it('returns null for an object with version:2', () => {
    expect(asSourceDocument({ version: 2, blocks: [] })).toBeNull()
  })

  it('returns null when blocks is missing', () => {
    expect(asSourceDocument({ version: 1 })).toBeNull()
  })

  it('returns null when blocks is not an array', () => {
    expect(asSourceDocument({ version: 1, blocks: 'oops' })).toBeNull()
  })

  it('returns the document when version:1 and blocks is an array', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    expect(asSourceDocument(doc)).toBe(doc)
  })

  it('returns the document when blocks contains actual blocks', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [
        {
          id: 'b_abc',
          type: 'paragraph',
          runs: [{ text: 'hello' }],
        },
      ],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    const result = asSourceDocument(doc)
    expect(result).not.toBeNull()
    expect(result?.blocks).toHaveLength(1)
  })
})

// ---- documentToContextLines -------------------------------------------------

describe('documentToContextLines', () => {
  it('returns a line per non-empty block with blockId, type, and text', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [
        { id: 'b_1', type: 'heading', level: 1, text: 'Title' },
        { id: 'b_2', type: 'paragraph', runs: [{ text: 'Body text' }] },
      ],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    const lines = documentToContextLines(doc)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({ blockId: 'b_1', type: 'heading', text: 'Title' })
    expect(lines[1]).toEqual({
      blockId: 'b_2',
      type: 'paragraph',
      text: 'Body text',
    })
  })

  it('drops image blocks that have no alt or caption (empty text)', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [
        { id: 'b_img', type: 'image', src: 'photo.png' },
        { id: 'b_p', type: 'paragraph', runs: [{ text: 'after' }] },
      ],
      extractor: 'html-heuristic@1',
      degraded: false,
    }
    const lines = documentToContextLines(doc)
    // The image-only block should be absent; the paragraph should appear
    const types = lines.map((l) => l.type)
    expect(types).not.toContain('image')
    expect(types).toContain('paragraph')
  })

  it('includes an image block when it has an alt text', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [
        { id: 'b_img', type: 'image', src: 'photo.png', alt: 'a diagram' },
      ],
      extractor: 'html-heuristic@1',
      degraded: false,
    }
    const lines = documentToContextLines(doc)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('a diagram')
  })

  it('includes a list block and renders its items with bullets', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [
        {
          id: 'b_list',
          type: 'list',
          ordered: false,
          items: [[{ text: 'alpha' }], [{ text: 'beta' }]],
        },
      ],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    const lines = documentToContextLines(doc)
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toContain('alpha')
    expect(lines[0].text).toContain('beta')
  })

  it('returns empty array for a document with no blocks', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    expect(documentToContextLines(doc)).toEqual([])
  })
})

// ---- documentToPromptContext ------------------------------------------------

describe('documentToPromptContext', () => {
  it('renders lines as [blockId] text joined by newlines', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [
        { id: 'b_1', type: 'heading', level: 1, text: 'Title' },
        { id: 'b_2', type: 'paragraph', runs: [{ text: 'Body' }] },
      ],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    const ctx = documentToPromptContext(doc)
    expect(ctx).toContain('[b_1] Title')
    expect(ctx).toContain('[b_2] Body')
  })

  it('respects maxChars cap — output length does not exceed the cap', () => {
    // Build a document with many blocks so the full context would exceed a small cap.
    const blocks = Array.from({ length: 50 }, (_, i) => ({
      id: `b_${i}`,
      type: 'paragraph' as const,
      runs: [
        {
          text: `This is paragraph number ${i} with a somewhat longer piece of text to use up space.`,
        },
      ],
    }))
    const doc: SourceDocument = {
      version: 1,
      blocks,
      extractor: 'text-markdown@1',
      degraded: false,
    }
    const maxChars = 200
    const ctx = documentToPromptContext(doc, maxChars)
    expect(ctx.length).toBeLessThanOrEqual(maxChars)
  })

  it('includes content when maxChars is large enough', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [{ id: 'b_1', type: 'paragraph', runs: [{ text: 'hello' }] }],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    const ctx = documentToPromptContext(doc, 10_000)
    expect(ctx).toContain('hello')
  })

  it('returns empty string for a document with no blocks', () => {
    const doc: SourceDocument = {
      version: 1,
      blocks: [],
      extractor: 'text-markdown@1',
      degraded: false,
    }
    expect(documentToPromptContext(doc)).toBe('')
  })
})
