import {
  repairArticleTraceability,
  repairReshapingPlan,
  repairStructureModel,
} from './traceability-repair.util'

type Rec = Record<string, unknown>
const asRec = (v: unknown): Rec => v as Rec
const known = new Set(['b1', 'b2', 'b3'])

describe('repairStructureModel', () => {
  it('drops the invented id from a mixed array, keeping the real ones', () => {
    const out = asRec(
      repairStructureModel(
        {
          claims: [{ text: 'c', sourceBlockIds: ['b1', 'ghost', 'b2'] }],
          definitions: [],
          examples: [],
          caveats: [],
          terminology: [],
          originalOutline: [],
          noiseDecisions: [],
          uncertainBlockIds: [],
        },
        known,
      ),
    )
    expect((out.claims as Rec[])[0].sourceBlockIds).toEqual(['b1', 'b2'])
  })

  it('drops an entry left with no valid reference', () => {
    const out = asRec(
      repairStructureModel(
        {
          claims: [
            { text: 'keep', sourceBlockIds: ['b1'] },
            { text: 'drop', sourceBlockIds: ['ghost'] },
          ],
          definitions: [],
          examples: [],
          caveats: [],
          terminology: [],
          originalOutline: [],
          noiseDecisions: [],
          uncertainBlockIds: [],
        },
        known,
      ),
    )
    expect((out.claims as Rec[]).map((c) => c.text)).toEqual(['keep'])
  })

  it('nulls an optional title/subtitle whose only citation was invented', () => {
    const out = asRec(
      repairStructureModel(
        {
          title: { text: 'T', sourceBlockIds: ['ghost'] },
          subtitle: { text: 'S', sourceBlockIds: ['b1', 'ghost'] },
          claims: [],
          definitions: [],
          examples: [],
          caveats: [],
          terminology: [],
          originalOutline: [],
          noiseDecisions: [],
          uncertainBlockIds: [],
        },
        known,
      ),
    )
    expect(out.title).toBeNull()
    expect(out.subtitle).toEqual({ text: 'S', sourceBlockIds: ['b1'] })
  })

  it('prunes noiseDecisions and uncertainBlockIds to real ids', () => {
    const out = asRec(
      repairStructureModel(
        {
          claims: [],
          definitions: [],
          examples: [],
          caveats: [],
          terminology: [],
          originalOutline: [],
          noiseDecisions: [
            { blockId: 'b3', reason: 'nav' },
            { blockId: 'ghost', reason: 'invented' },
          ],
          uncertainBlockIds: ['b2', 'ghost'],
        },
        known,
      ),
    )
    expect((out.noiseDecisions as Rec[]).map((n) => n.blockId)).toEqual(['b3'])
    expect(out.uncertainBlockIds).toEqual(['b2'])
  })

  it('does not mutate the input and passes non-objects through', () => {
    const input = {
      claims: [{ text: 'c', sourceBlockIds: ['b1', 'ghost'] }],
      definitions: [],
      examples: [],
      caveats: [],
      terminology: [],
      originalOutline: [],
      noiseDecisions: [],
      uncertainBlockIds: [],
    }
    const snapshot = JSON.parse(JSON.stringify(input))
    repairStructureModel(input, known)
    expect(input).toEqual(snapshot)
    expect(repairStructureModel(null, known)).toBeNull()
    expect(repairStructureModel('x', known)).toBe('x')
  })
})

describe('repairReshapingPlan', () => {
  const section = (over: Rec = {}): Rec => ({
    heading: 'H',
    headingSource: 'original',
    sourceBlockIds: ['b1'],
    allowedTransformations: [],
    ...over,
  })

  it('drops a section with no traceable reference, keeping valid ones', () => {
    const out = asRec(
      repairReshapingPlan(
        {
          titleProposal: { text: 'T', source: 'original' },
          sections: [
            section({ heading: 'keep', sourceBlockIds: ['b1', 'ghost'] }),
            section({ heading: 'drop', sourceBlockIds: ['ghost'] }),
          ],
          removedBlocks: [],
          warnings: [],
        },
        known,
      ),
    )
    const sections = out.sections as Rec[]
    expect(sections.map((s) => s.heading)).toEqual(['keep'])
    expect(sections[0].sourceBlockIds).toEqual(['b1'])
  })

  it('omits an emptied optional headingSourceBlockIds', () => {
    const out = asRec(
      repairReshapingPlan(
        {
          titleProposal: { text: 'T', source: 'original' },
          sections: [section({ headingSourceBlockIds: ['ghost'] })],
          removedBlocks: [],
          warnings: [],
        },
        known,
      ),
    )
    expect((out.sections as Rec[])[0]).not.toHaveProperty(
      'headingSourceBlockIds',
    )
  })

  it('prunes subsections one level the same way', () => {
    const out = asRec(
      repairReshapingPlan(
        {
          titleProposal: { text: 'T', source: 'original' },
          sections: [
            section({
              subsections: [
                section({ heading: 'sub-keep', sourceBlockIds: ['b2'] }),
                section({ heading: 'sub-drop', sourceBlockIds: ['ghost'] }),
              ],
            }),
          ],
          removedBlocks: [],
          warnings: [],
        },
        known,
      ),
    )
    const subs = (out.sections as Rec[])[0].subsections as Rec[]
    expect(subs.map((s) => s.heading)).toEqual(['sub-keep'])
  })

  it('drops a reorder audit anchored on an invented block', () => {
    const out = asRec(
      repairReshapingPlan(
        {
          titleProposal: { text: 'T', source: 'original' },
          sections: [section()],
          removedBlocks: [],
          warnings: [],
          reorderings: [
            {
              sourceBlockId: 'b1',
              fromIndex: 0,
              toIndex: 1,
              reason: 'r',
              risk: 'low',
              movedWithClusterIds: ['b2', 'ghost'],
            },
            {
              sourceBlockId: 'ghost',
              fromIndex: 1,
              toIndex: 0,
              reason: 'r',
              risk: 'low',
            },
          ],
        },
        known,
      ),
    )
    const reorderings = out.reorderings as Rec[]
    expect(reorderings).toHaveLength(1)
    expect(reorderings[0].sourceBlockId).toBe('b1')
    expect(reorderings[0].movedWithClusterIds).toEqual(['b2'])
  })

  it('leaves removedBlocks untouched (the service tolerates unknown ids there)', () => {
    const out = asRec(
      repairReshapingPlan(
        {
          titleProposal: { text: 'T', source: 'original' },
          sections: [section()],
          removedBlocks: [{ blockId: 'ghost', reason: 'noise' }],
          warnings: [],
        },
        known,
      ),
    )
    expect(out.removedBlocks).toEqual([{ blockId: 'ghost', reason: 'noise' }])
  })
})

describe('repairArticleTraceability', () => {
  const base = {
    title: { text: 'T', source: 'original' },
    abstract: [{ text: 'a', sourceBlockIds: ['b1'] }],
    sections: [],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
  }

  it('prunes an invented id from a block, keeping the real ones', () => {
    const out = asRec(
      repairArticleTraceability(
        {
          ...base,
          sections: [
            {
              id: 's1',
              heading: 'H',
              sourceBlockIds: ['b1'],
              blocks: [
                {
                  id: 'p1',
                  type: 'paragraph',
                  text: 'x',
                  sourceBlockIds: ['b1', 'ghost', 'b2'],
                },
              ],
            },
          ],
        },
        known,
      ),
    )
    const block = (asRec((out.sections as Rec[])[0]).blocks as Rec[])[0]
    expect(block.sourceBlockIds).toEqual(['b1', 'b2'])
  })

  it('drops a block left with no valid source, keeping the section', () => {
    const out = asRec(
      repairArticleTraceability(
        {
          ...base,
          sections: [
            {
              id: 's1',
              heading: 'H',
              sourceBlockIds: ['b1'],
              blocks: [
                {
                  id: 'p1',
                  type: 'paragraph',
                  text: 'x',
                  sourceBlockIds: ['ghost'],
                },
                {
                  id: 'p2',
                  type: 'paragraph',
                  text: 'y',
                  sourceBlockIds: ['b2'],
                },
              ],
            },
          ],
        },
        known,
      ),
    )
    const section = asRec((out.sections as Rec[])[0])
    expect((section.blocks as Rec[]).map((b) => b.id)).toEqual(['p2'])
  })

  it('drops a section whose own provenance was entirely invented', () => {
    const out = asRec(
      repairArticleTraceability(
        {
          ...base,
          sections: [
            { id: 's1', heading: 'H', sourceBlockIds: ['ghost'], blocks: [] },
            { id: 's2', heading: 'K', sourceBlockIds: ['b1'], blocks: [] },
          ],
        },
        known,
      ),
    )
    expect((out.sections as Rec[]).map((s) => s.id)).toEqual(['s2'])
  })

  it('prunes nested subsections + heading ids, and drops an unsourced subtitle', () => {
    const out = asRec(
      repairArticleTraceability(
        {
          ...base,
          subtitle: { text: 'sub', sourceBlockIds: ['ghost'] },
          sections: [
            {
              id: 's1',
              heading: 'H',
              sourceBlockIds: ['b1'],
              headingSourceBlockIds: ['b1', 'ghost'],
              blocks: [],
              subsections: [
                {
                  id: 's1a',
                  heading: 'A',
                  sourceBlockIds: ['ghost'],
                  blocks: [],
                },
                { id: 's1b', heading: 'B', sourceBlockIds: ['b2'], blocks: [] },
              ],
            },
          ],
        },
        known,
      ),
    )
    expect(out.subtitle).toBeUndefined()
    const section = asRec((out.sections as Rec[])[0])
    expect(section.headingSourceBlockIds).toEqual(['b1'])
    expect((section.subsections as Rec[]).map((s) => s.id)).toEqual(['s1b'])
  })

  it('prunes top-level keyTerms / sourceExamples / caveats and passes through non-objects', () => {
    const out = asRec(
      repairArticleTraceability(
        {
          ...base,
          keyTerms: [
            { term: 't', sourceBlockIds: ['b1', 'ghost'] },
            { term: 'u', sourceBlockIds: ['ghost'] },
          ],
        },
        known,
      ),
    )
    const terms = out.keyTerms as Rec[]
    expect(terms).toHaveLength(1)
    expect(terms[0].sourceBlockIds).toEqual(['b1'])
    expect(repairArticleTraceability(null, known)).toBeNull()
  })
})
