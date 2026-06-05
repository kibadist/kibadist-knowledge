import {
  makeBlockId,
  makeSectionId,
  type RawArticleSection,
  stampArticleIds,
} from './article-id.util'

describe('makeSectionId / makeBlockId — determinism', () => {
  it('same (articleId, orderIndex) yields the same section id', () => {
    expect(makeSectionId('a_1', 0)).toBe(makeSectionId('a_1', 0))
  })

  it('different order index yields a different section id', () => {
    expect(makeSectionId('a_1', 0)).not.toBe(makeSectionId('a_1', 1))
  })

  it('different article version yields a different id space', () => {
    expect(makeSectionId('a_1', 0)).not.toBe(makeSectionId('a_2', 0))
  })

  it('section ids start with s_ and block ids with b_', () => {
    const section = makeSectionId('a_1', 0)
    expect(section).toMatch(/^s_/)
    expect(makeBlockId(section, 0)).toMatch(/^b_/)
  })

  it('same (sectionId, orderIndex) yields the same block id', () => {
    const section = makeSectionId('a_1', 0)
    expect(makeBlockId(section, 2)).toBe(makeBlockId(section, 2))
  })

  it('blocks in different sections do not collide at the same order index', () => {
    const s0 = makeSectionId('a_1', 0)
    const s1 = makeSectionId('a_1', 1)
    expect(makeBlockId(s0, 0)).not.toBe(makeBlockId(s1, 0))
  })
})

describe('stampArticleIds — stamps persisted ids and order_index', () => {
  const sections: RawArticleSection[] = [
    {
      heading: 'Intro',
      blocks: [
        { type: 'paragraph', content: { text: 'a' } },
        { type: 'paragraph', content: { text: 'b' } },
      ],
    },
    {
      heading: 'Body',
      blocks: [{ type: 'paragraph', content: { text: 'c' } }],
    },
  ]

  it('assigns ascending order_index to sections and blocks', () => {
    const out = stampArticleIds('a_1', sections)
    expect(out.map((s) => s.order_index)).toEqual([0, 1])
    expect(out[0].blocks.map((b) => b.order_index)).toEqual([0, 1])
    expect(out[1].blocks.map((b) => b.order_index)).toEqual([0])
  })

  it('every block carries its parent section_id', () => {
    const out = stampArticleIds('a_1', sections)
    for (const section of out) {
      for (const block of section.blocks) {
        expect(block.section_id).toBe(section.section_id)
      }
    }
  })

  it('all block ids in an article are unique', () => {
    const out = stampArticleIds('a_1', sections)
    const ids = out.flatMap((s) => s.blocks.map((b) => b.block_id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('re-stamping the same structure for the same article id is stable', () => {
    const first = stampArticleIds('a_1', sections)
    const second = stampArticleIds('a_1', sections)
    expect(second).toEqual(first)
  })

  it('a material regeneration (new article id) yields a fresh id space', () => {
    const v1 = stampArticleIds('a_1', sections)
    const v2 = stampArticleIds('a_2', sections)
    expect(v2[0].section_id).not.toBe(v1[0].section_id)
    expect(v2[0].blocks[0].block_id).not.toBe(v1[0].blocks[0].block_id)
  })

  it('preserves the original block payload fields', () => {
    const out = stampArticleIds('a_1', sections)
    expect(out[0].blocks[0].content).toEqual({ text: 'a' })
    expect(out[0].blocks[0].type).toBe('paragraph')
  })
})
