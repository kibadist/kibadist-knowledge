import { repairArticleLlmV2 } from './article-llm-repair.util'

type Rec = Record<string, unknown>
const asRec = (v: unknown): Rec => v as Rec
const sections = (v: unknown): Rec[] => asRec(v).sections as Rec[]

describe('repairArticleLlmV2', () => {
  it('drops an empty subtitle but keeps a real one', () => {
    expect(
      asRec(repairArticleLlmV2({ subtitle: { text: '   ' }, sections: [] }))
        .subtitle,
    ).toBeUndefined()
    expect(
      asRec(repairArticleLlmV2({ subtitle: { text: '' }, sections: [] }))
        .subtitle,
    ).toBeUndefined()

    const kept = { text: 'A real subtitle', source: 'verbatim' }
    expect(
      asRec(repairArticleLlmV2({ subtitle: kept, sections: [] })).subtitle,
    ).toEqual(kept)
  })

  it('defaults a container section with no blocks to an empty blocks array', () => {
    const repaired = repairArticleLlmV2({
      sections: [{ id: 's1', heading: 'H', subsections: [] }],
    })
    expect(sections(repaired)[0].blocks).toEqual([])
  })

  it('generates anchor ids for sections, subsections, and blocks that lack them', () => {
    const repaired = repairArticleLlmV2({
      sections: [
        {
          heading: 'Why It Works',
          // no id, no blocks
          subsections: [
            { heading: 'First' }, // no id, no blocks
            { heading: 'Second' },
          ],
        },
      ],
    })
    const sec = sections(repaired)[0]
    expect(typeof sec.id).toBe('string')
    expect((sec.id as string).length).toBeGreaterThan(0)
    expect(sec.blocks).toEqual([])
    const subs = sec.subsections as Rec[]
    expect(typeof subs[0].id).toBe('string')
    expect(typeof subs[1].id).toBe('string')
    // Generated ids are unique within the article.
    const ids = [sec.id, subs[0].id, subs[1].id]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preserves ids that are already present', () => {
    const repaired = repairArticleLlmV2({
      sections: [
        {
          id: 'keep-me',
          heading: 'H',
          blocks: [{ type: 'paragraph', id: 'b-keep', text: 'x' }],
        },
      ],
    })
    const sec = sections(repaired)[0]
    expect(sec.id).toBe('keep-me')
    expect((sec.blocks as Rec[])[0].id).toBe('b-keep')
  })

  it('fills a missing block id from the section without touching other fields', () => {
    const repaired = repairArticleLlmV2({
      sections: [
        {
          id: 's1',
          heading: 'H',
          blocks: [{ type: 'paragraph', text: 'no id here' }],
        },
      ],
    })
    const block = (sections(repaired)[0].blocks as Rec[])[0]
    expect(typeof block.id).toBe('string')
    expect((block.id as string).length).toBeGreaterThan(0)
    expect(block.text).toBe('no id here')
    expect(block.type).toBe('paragraph')
  })

  it('reproduces the reported failure shape: section.2 with subsections, no blocks, no ids', () => {
    // Mirrors the FAILED article: sections[2] has subsections without ids and
    // no blocks array of its own.
    const repaired = repairArticleLlmV2({
      subtitle: { text: '' },
      sections: [
        { id: 's0', heading: 'A', blocks: [] },
        { id: 's1', heading: 'B', blocks: [] },
        {
          heading: 'C',
          subsections: [
            { heading: 'c0' },
            { heading: 'c1' },
            { heading: 'c2' },
          ],
        },
      ],
    })
    const out = asRec(repaired)
    expect(out.subtitle).toBeUndefined()
    const third = sections(repaired)[2]
    expect(third.blocks).toEqual([])
    expect(typeof third.id).toBe('string')
    for (const sub of third.subsections as Rec[]) {
      expect(typeof sub.id).toBe('string')
      expect((sub.id as string).length).toBeGreaterThan(0)
      expect(sub.blocks).toEqual([])
    }
  })

  it('returns non-object input untouched (zod will reject it loudly)', () => {
    expect(repairArticleLlmV2(null)).toBeNull()
    expect(repairArticleLlmV2('nope')).toBe('nope')
    expect(repairArticleLlmV2([1, 2])).toEqual([1, 2])
  })

  it('does not mutate the input', () => {
    const input = { subtitle: { text: '' }, sections: [{ heading: 'H' }] }
    const snapshot = JSON.parse(JSON.stringify(input))
    repairArticleLlmV2(input)
    expect(input).toEqual(snapshot)
  })
})
