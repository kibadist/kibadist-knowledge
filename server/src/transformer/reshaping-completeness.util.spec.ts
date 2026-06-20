import {
  applyCorrectiveAssignments,
  backstopUncovered,
  type CompletenessBlock,
  findUncoveredBlockIds,
} from './reshaping-completeness.util'

const blk = (id: string, removable = false): CompletenessBlock => ({
  id,
  removable,
})

describe('findUncoveredBlockIds', () => {
  it('returns non-removable blocks neither cited nor removed, in source order', () => {
    const blocks = [blk('b1'), blk('b2'), blk('b3'), blk('b4', true)]
    const sections = [{ sourceBlockIds: ['b1'] }]
    const removed = new Set(['b4'])
    // b1 cited; b4 removable+removed; b2/b3 silently dropped.
    expect(findUncoveredBlockIds(sections, removed, blocks)).toEqual([
      'b2',
      'b3',
    ])
  })

  it('treats blocks cited inside a subsection as covered', () => {
    const blocks = [blk('b1'), blk('b2')]
    const sections = [
      { sourceBlockIds: ['b1'], subsections: [{ sourceBlockIds: ['b2'] }] },
    ]
    expect(findUncoveredBlockIds(sections, new Set(), blocks)).toEqual([])
  })

  it('never reports a removable block, even when uncited and not in removedBlocks', () => {
    const blocks = [blk('b1'), blk('b2', true)]
    const sections = [{ sourceBlockIds: ['b1'] }]
    expect(findUncoveredBlockIds(sections, new Set(), blocks)).toEqual([])
  })
})

describe('backstopUncovered', () => {
  it('appends each uncovered block to the section holding its nearest source-order neighbour', () => {
    const blocks = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5'].map((id) => blk(id))
    const sections = [
      { heading: 'A', sourceBlockIds: ['b0', 'b1'] },
      { heading: 'B', sourceBlockIds: ['b4', 'b5'] },
    ]
    const out = backstopUncovered(sections, ['b2', 'b3'], blocks)
    // b2 (idx 2) is nearest b1 (A); b3 (idx 3) is nearest b4 (B).
    expect(out[0].sourceBlockIds).toEqual(['b0', 'b1', 'b2'])
    expect(out[1].sourceBlockIds).toEqual(['b4', 'b5', 'b3'])
    // Other section fields are preserved.
    expect(out[0].heading).toBe('A')
  })

  it('counts subsection-cited blocks when choosing the nearest section', () => {
    const blocks = ['b0', 'b1', 'b2'].map((id) => blk(id))
    const sections = [
      { heading: 'A', sourceBlockIds: ['b0'] },
      {
        heading: 'B',
        sourceBlockIds: ['x'],
        subsections: [{ sourceBlockIds: ['b1'] }],
      },
    ]
    // b2 (idx 2) is nearest b1, which lives in B's subsection → assign to B.
    const out = backstopUncovered(sections, ['b2'], blocks)
    expect(out[1].sourceBlockIds).toEqual(['x', 'b2'])
    expect(out[0].sourceBlockIds).toEqual(['b0'])
  })

  it('does not mutate the input sections', () => {
    const blocks = ['b0', 'b1'].map((id) => blk(id))
    const sections = [{ heading: 'A', sourceBlockIds: ['b0'] }]
    backstopUncovered(sections, ['b1'], blocks)
    expect(sections[0].sourceBlockIds).toEqual(['b0'])
  })
})

describe('applyCorrectiveAssignments', () => {
  it('appends an assigned block to its target section', () => {
    const sections = [
      { heading: 'A', sourceBlockIds: ['b0'] },
      { heading: 'B', sourceBlockIds: ['b1'] },
    ]
    const res = applyCorrectiveAssignments(
      sections,
      [{ blockId: 'b2', sectionIndex: 1 }],
      new Set(),
    )
    expect(res.sections[1].sourceBlockIds).toEqual(['b1', 'b2'])
    expect(res.removedBlockIds).toEqual([])
  })

  it('removes a block only when it is actually removable', () => {
    const sections = [{ heading: 'A', sourceBlockIds: ['b0'] }]
    const res = applyCorrectiveAssignments(
      sections,
      [
        { blockId: 'b1', sectionIndex: null }, // removable → removed
        { blockId: 'b2', sectionIndex: null }, // protected → ignored, left for backstop
      ],
      new Set(['b1']),
    )
    expect(res.removedBlockIds).toEqual(['b1'])
    expect(res.sections[0].sourceBlockIds).toEqual(['b0'])
  })

  it('ignores an out-of-range section index (left for the backstop)', () => {
    const sections = [{ heading: 'A', sourceBlockIds: ['b0'] }]
    const res = applyCorrectiveAssignments(
      sections,
      [{ blockId: 'b1', sectionIndex: 5 }],
      new Set(),
    )
    expect(res.sections[0].sourceBlockIds).toEqual(['b0'])
    expect(res.removedBlockIds).toEqual([])
  })

  it('does not duplicate an id already cited in the target section', () => {
    const sections = [{ heading: 'A', sourceBlockIds: ['b0'] }]
    const res = applyCorrectiveAssignments(
      sections,
      [{ blockId: 'b0', sectionIndex: 0 }],
      new Set(),
    )
    expect(res.sections[0].sourceBlockIds).toEqual(['b0'])
  })
})
