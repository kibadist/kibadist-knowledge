import { chunkDocument } from './chunk-document.util'
import type { SourceBlock, SourceDocument } from './source-document.types'

function doc(blocks: SourceBlock[], title?: string): SourceDocument {
  return {
    version: 1,
    title,
    blocks,
    extractor: 'text-markdown@1',
    degraded: false,
  }
}

describe('chunkDocument', () => {
  it('returns [] for a document with no blocks', () => {
    expect(chunkDocument(doc([]))).toEqual([])
  })

  it('returns a single whole-doc chunk for a heading-less document', () => {
    const chunks = chunkDocument(
      doc(
        [
          { id: 'b_1', type: 'paragraph', runs: [{ text: 'First.' }] },
          { id: 'b_2', type: 'paragraph', runs: [{ text: 'Second.' }] },
        ],
        'My Article',
      ),
    )
    expect(chunks).toHaveLength(1)
    expect(chunks[0].title).toBe('My Article')
    expect(chunks[0].blockIds).toEqual(['b_1', 'b_2'])
  })

  it("falls back to 'Article' when a heading-less document has no title", () => {
    const chunks = chunkDocument(
      doc([{ id: 'b_1', type: 'paragraph', runs: [{ text: 'Body.' }] }]),
    )
    expect(chunks).toHaveLength(1)
    expect(chunks[0].title).toBe('Article')
  })

  it('splits an intro + two h2 sections into 3 chunks with grouped blocks', () => {
    const chunks = chunkDocument(
      doc([
        { id: 'b_lead', type: 'paragraph', runs: [{ text: 'Lead-in text.' }] },
        { id: 'b_h1', type: 'heading', level: 2, text: 'Section One' },
        { id: 'b_p1', type: 'paragraph', runs: [{ text: 'One body.' }] },
        { id: 'b_h2', type: 'heading', level: 2, text: 'Section Two' },
        { id: 'b_p2', type: 'paragraph', runs: [{ text: 'Two body.' }] },
      ]),
    )

    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => c.title)).toEqual([
      'Introduction',
      'Section One',
      'Section Two',
    ])
    expect(chunks[0].blockIds).toEqual(['b_lead'])
    expect(chunks[1].blockIds).toEqual(['b_h1', 'b_p1'])
    expect(chunks[2].blockIds).toEqual(['b_h2', 'b_p2'])
  })

  it('keeps a deeper h3 INSIDE its parent h2 chunk (split at the major level only)', () => {
    const chunks = chunkDocument(
      doc([
        { id: 'b_h2', type: 'heading', level: 2, text: 'Major' },
        { id: 'b_p1', type: 'paragraph', runs: [{ text: 'Intro to major.' }] },
        { id: 'b_h3', type: 'heading', level: 3, text: 'Minor' },
        { id: 'b_p2', type: 'paragraph', runs: [{ text: 'Sub body.' }] },
      ]),
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0].title).toBe('Major')
    expect(chunks[0].blockIds).toEqual(['b_h2', 'b_p1', 'b_h3', 'b_p2'])
  })

  it("sets a chunk's id to its first block's id", () => {
    const chunks = chunkDocument(
      doc([
        { id: 'b_h2', type: 'heading', level: 2, text: 'Section' },
        { id: 'b_p1', type: 'paragraph', runs: [{ text: 'Body.' }] },
      ]),
    )
    expect(chunks[0].id).toBe('b_h2')
  })

  it('counts words across a chunk (wordCount > 0 for non-empty chunks)', () => {
    const chunks = chunkDocument(
      doc([
        { id: 'b_h2', type: 'heading', level: 2, text: 'Two Words' },
        { id: 'b_p1', type: 'paragraph', runs: [{ text: 'Three more words' }] },
      ]),
    )
    expect(chunks).toHaveLength(1)
    expect(chunks[0].wordCount).toBe(5)
  })
})
