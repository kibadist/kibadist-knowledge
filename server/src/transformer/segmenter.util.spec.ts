import { TransformerBlockType } from '@kibadist/prisma'

import type {
  SourceBlock,
  SourceDocument,
} from '../source-document/source-document'
import type { PdfPageBlocks } from './pdf-pages.util'
import { segmentDocument, segmentPdfPages } from './segmenter.util'

function doc(blocks: SourceBlock[]): SourceDocument {
  return {
    version: 1,
    blocks,
    extractor: 'text-markdown@1',
    degraded: false,
  }
}

describe('segmentDocument', () => {
  it('maps block types and preserves order', () => {
    const result = segmentDocument(
      doc([
        { id: 'a', type: 'heading', level: 1, text: 'Title' },
        { id: 'b', type: 'paragraph', runs: [{ text: 'Hello world' }] },
        { id: 'c', type: 'quote', runs: [{ text: 'A quote' }] },
        {
          id: 'd',
          type: 'list',
          ordered: false,
          items: [[{ text: 'one' }], [{ text: 'two' }]],
        },
        { id: 'e', type: 'code', text: 'const x = 1' },
        { id: 'f', type: 'table', header: false, rows: [['a', 'b']] },
      ]),
    )
    expect(result.blocks.map((b) => b.blockType)).toEqual([
      TransformerBlockType.HEADING,
      TransformerBlockType.PARAGRAPH,
      TransformerBlockType.QUOTE,
      TransformerBlockType.LIST,
      TransformerBlockType.CODE,
      TransformerBlockType.TABLE,
    ])
    expect(result.blocks.map((b) => b.orderIndex)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('preserves heading depth (level) on HEADING blocks, null elsewhere (DET-276)', () => {
    const result = segmentDocument(
      doc([
        { id: 'a', type: 'heading', level: 2, text: 'Section' },
        { id: 'b', type: 'heading', level: 3, text: 'Subsection' },
        { id: 'c', type: 'paragraph', runs: [{ text: 'Body' }] },
      ]),
    )
    expect(result.blocks.map((b) => b.blockType)).toEqual([
      TransformerBlockType.HEADING,
      TransformerBlockType.HEADING,
      TransformerBlockType.PARAGRAPH,
    ])
    // Heading depth survives segmentation; non-heading blocks carry null.
    expect(result.blocks.map((b) => b.headingLevel)).toEqual([2, 3, null])
  })

  it('image → CAPTION when it has alt/caption text', () => {
    const result = segmentDocument(
      doc([
        { id: 'a', type: 'image', src: 'x.png', alt: 'A diagram' },
        { id: 'b', type: 'image', src: 'y.png', caption: 'Figure 2' },
      ]),
    )
    expect(result.blocks.map((b) => b.blockType)).toEqual([
      TransformerBlockType.CAPTION,
      TransformerBlockType.CAPTION,
    ])
    expect(result.blocks.map((b) => b.text)).toEqual(['A diagram', 'Figure 2'])
  })

  it('drops a captionless image (not stored, no index allocated)', () => {
    const result = segmentDocument(
      doc([
        { id: 'a', type: 'paragraph', runs: [{ text: 'Before' }] },
        { id: 'b', type: 'image', src: 'x.png' },
        { id: 'c', type: 'paragraph', runs: [{ text: 'After' }] },
      ]),
    )
    expect(result.blocks).toHaveLength(2)
    // The dropped image never consumes an order index: 0 then 1, contiguous.
    expect(result.blocks.map((b) => b.orderIndex)).toEqual([0, 1])
    expect(result.blocks.map((b) => b.text)).toEqual(['Before', 'After'])
  })

  it('computes exact char offsets that index back into extractedText', () => {
    const result = segmentDocument(
      doc([
        { id: 'a', type: 'paragraph', runs: [{ text: 'First block' }] },
        { id: 'b', type: 'paragraph', runs: [{ text: 'Second block' }] },
        { id: 'c', type: 'paragraph', runs: [{ text: 'Third' }] },
      ]),
    )
    // The canonical text is the block texts joined with "\n\n".
    expect(result.extractedText).toBe('First block\n\nSecond block\n\nThird')
    // Every block's [charStart, charEnd) slices back to its exact text.
    for (const b of result.blocks) {
      expect(result.extractedText.slice(b.charStart, b.charEnd)).toBe(b.text)
    }
    // First block starts at 0; the second starts after "First block\n\n".
    expect(result.blocks[0].charStart).toBe(0)
    expect(result.blocks[1].charStart).toBe('First block\n\n'.length)
  })

  it('text/URL blocks carry no page number', () => {
    const result = segmentDocument(
      doc([{ id: 'a', type: 'paragraph', runs: [{ text: 'x' }] }]),
    )
    expect(result.blocks[0].pageNumber).toBeNull()
  })
})

describe('segmentPdfPages', () => {
  it('tags blocks with their page number and keeps page order', () => {
    const pages: PdfPageBlocks[] = [
      {
        pageNumber: 1,
        blocks: [{ id: 'a', type: 'paragraph', runs: [{ text: 'Page one' }] }],
      },
      {
        pageNumber: 2,
        blocks: [
          { id: 'b', type: 'paragraph', runs: [{ text: 'Page two para A' }] },
          { id: 'c', type: 'paragraph', runs: [{ text: 'Page two para B' }] },
        ],
      },
    ]
    const result = segmentPdfPages(pages)
    expect(result.blocks.map((b) => b.pageNumber)).toEqual([1, 2, 2])
    expect(result.blocks.map((b) => b.orderIndex)).toEqual([0, 1, 2])
    // Offsets remain exact across page boundaries.
    for (const b of result.blocks) {
      expect(result.extractedText.slice(b.charStart, b.charEnd)).toBe(b.text)
    }
  })
})
