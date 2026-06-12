import {
  coveredBlockIds,
  findUnknownSegmentBlockIds,
  findUnreasonedHighImportanceBlocks,
  HIGH_IMPORTANCE_CLASSES,
  isHighImportanceBlock,
  orderSegmentsBySource,
  repairSegmentation,
} from './conceptual-segmentation.util'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ConceptualSegmentation, SourceSegment } from './transformer.types'

function block(
  id: string,
  classification: string,
  removable = false,
): ClassifiedBlockInput {
  return { id, type: 'PARAGRAPH', classification, text: id, removable }
}

function segment(id: string, sourceBlockIds: string[]): SourceSegment {
  return {
    id,
    title: id,
    role: 'definition',
    sourceBlockIds,
    importance: 'high',
    summary: id,
    mustPreserveClaims: [],
    suggestedArticlePlacement: 'main_body',
  }
}

describe('isHighImportanceBlock', () => {
  it('is true for non-removable substance classes', () => {
    for (const cls of HIGH_IMPORTANCE_CLASSES) {
      expect(isHighImportanceBlock(block('b', cls))).toBe(true)
    }
  })

  it('is false for a removable block even with a substance class', () => {
    expect(isHighImportanceBlock(block('b', 'DEFINITION', true))).toBe(false)
  })

  it('is false for low-signal classes', () => {
    for (const cls of ['BACKGROUND', 'SIDEBAR', 'CITATION', 'UNCERTAIN']) {
      expect(isHighImportanceBlock(block('b', cls))).toBe(false)
    }
  })
})

describe('coveredBlockIds', () => {
  it('flattens every segment’s sourceBlockIds into one set', () => {
    const covered = coveredBlockIds({
      segments: [segment('seg-0', ['b1', 'b2']), segment('seg-1', ['b3'])],
    })
    expect([...covered].sort()).toEqual(['b1', 'b2', 'b3'])
  })
})

describe('orderSegmentsBySource', () => {
  const blocks = [
    block('b1', 'DEFINITION'),
    block('b2', 'DEFINITION'),
    block('b3', 'DEFINITION'),
  ]

  it('sorts segments by their earliest cited block (source-reading order)', () => {
    // Segments handed in reverse order — must come back in source order.
    const ordered = orderSegmentsBySource(
      [segment('x', ['b3']), segment('y', ['b1']), segment('z', ['b2'])],
      blocks,
    )
    expect(ordered.map((s) => s.id)).toEqual(['y', 'z', 'x'])
  })

  it('is stable for segments that share an earliest block', () => {
    const a = segment('a', ['b1'])
    const b = segment('b', ['b1'])
    expect(orderSegmentsBySource([a, b], blocks).map((s) => s.id)).toEqual([
      'a',
      'b',
    ])
  })
})

describe('findUnknownSegmentBlockIds', () => {
  it('reports ids cited by segments or unsegmentedBlocks that the source lacks', () => {
    const segmentation: ConceptualSegmentation = {
      segments: [segment('seg-0', ['b1', 'ghost'])],
      unsegmentedBlocks: [{ blockId: 'phantom', reason: 'x' }],
      warnings: [],
    }
    const unknown = findUnknownSegmentBlockIds(segmentation, new Set(['b1']))
    expect(unknown.sort()).toEqual(['ghost', 'phantom'])
  })
})

describe('findUnreasonedHighImportanceBlocks (DET-347 acceptance)', () => {
  const blocks = [
    block('b1', 'MAIN_ARGUMENT'),
    block('b2', 'DEFINITION'),
    block('b3', 'BACKGROUND'), // low-importance — may be dropped silently
    block('b4', 'FOOTER', true), // removable noise
  ]

  it('returns nothing when every high-importance block is segmented', () => {
    const segmentation: ConceptualSegmentation = {
      segments: [segment('seg-0', ['b1', 'b2'])],
      unsegmentedBlocks: [],
      warnings: [],
    }
    expect(findUnreasonedHighImportanceBlocks(blocks, segmentation)).toEqual([])
  })

  it('returns nothing when an uncovered high-importance block has a recorded reason', () => {
    const segmentation: ConceptualSegmentation = {
      segments: [segment('seg-0', ['b1'])],
      unsegmentedBlocks: [{ blockId: 'b2', reason: 'duplicate of b1' }],
      warnings: [],
    }
    expect(findUnreasonedHighImportanceBlocks(blocks, segmentation)).toEqual([])
  })

  it('flags a high-importance block that is neither segmented nor reasoned', () => {
    const segmentation: ConceptualSegmentation = {
      segments: [segment('seg-0', ['b1'])],
      unsegmentedBlocks: [],
      warnings: [],
    }
    // b2 (DEFINITION) is orphaned; b3 (BACKGROUND) and b4 (removable) are not.
    expect(findUnreasonedHighImportanceBlocks(blocks, segmentation)).toEqual([
      'b2',
    ])
  })
})

describe('repairSegmentation', () => {
  const known = new Set(['b1', 'b2'])

  it('prunes invented ids and drops a segment left with no real provenance', () => {
    const repaired = repairSegmentation(
      {
        segments: [
          { title: 'keep', sourceBlockIds: ['b1', 'ghost'] },
          { title: 'drop', sourceBlockIds: ['ghost'] },
        ],
        unsegmentedBlocks: [
          { blockId: 'b2', reason: 'ok' },
          { blockId: 'phantom', reason: 'invented' },
        ],
      },
      known,
    ) as {
      segments: { title: string; sourceBlockIds: string[] }[]
      unsegmentedBlocks: { blockId: string }[]
    }

    expect(repaired.segments).toHaveLength(1)
    expect(repaired.segments[0]).toEqual({
      title: 'keep',
      sourceBlockIds: ['b1'],
    })
    expect(repaired.unsegmentedBlocks).toEqual([
      { blockId: 'b2', reason: 'ok' },
    ])
  })

  it('leaves a non-object input untouched (real breakage handed to zod)', () => {
    expect(repairSegmentation(42, known)).toBe(42)
  })
})
