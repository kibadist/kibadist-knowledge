import {
  type ArticleCoverBlock,
  appendVerbatimCoverage,
  findUncoveredSourceBlocks,
} from './article-completeness.util'
import type {
  ArticleJsonV2,
  ArticleParagraphBlock,
  ArticleSectionV2,
} from './transformer.types'

const para = (id: string, sourceBlockIds: string[]): ArticleParagraphBlock => ({
  id,
  type: 'paragraph',
  text: 'x',
  sourceBlockIds,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
})

const section = (
  id: string,
  sourceBlockIds: string[],
  blocks: ArticleParagraphBlock[],
  subsections?: ArticleSectionV2[],
): ArticleSectionV2 => ({
  id,
  heading: `H-${id}`,
  headingSource: 'inferred',
  sourceBlockIds,
  blocks,
  ...(subsections ? { subsections } : {}),
})

const article = (sections: ArticleSectionV2[]): ArticleJsonV2 => ({
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'T', source: 'inferred' },
  abstract: [],
  sections,
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
})

const blk = (id: string, removable = false): ArticleCoverBlock => ({
  id,
  text: `text-${id}`,
  removable,
})

describe('findUncoveredSourceBlocks', () => {
  it('returns non-removable blocks the article cites nowhere', () => {
    const a = article([section('s0', ['b1'], [para('p0', ['b1'])])])
    // b1 cited; b2 dropped; b9 removable.
    const out = findUncoveredSourceBlocks(a, [
      blk('b1'),
      blk('b2'),
      blk('b9', true),
    ])
    expect(out.map((b) => b.id)).toEqual(['b2'])
  })

  it('counts a citation inside a subsection block as covered', () => {
    const a = article([
      section(
        's0',
        ['b1'],
        [para('p0', ['b1'])],
        [section('s0a', ['b2'], [para('p1', ['b2'])])],
      ),
    ])
    expect(findUncoveredSourceBlocks(a, [blk('b1'), blk('b2')])).toEqual([])
  })

  it('counts a citation in keyTerms/caveats as covered', () => {
    const a = article([section('s0', ['b1'], [para('p0', ['b1'])])])
    a.caveats = [{ text: 'c', sourceBlockIds: ['b2'] }]
    expect(findUncoveredSourceBlocks(a, [blk('b1'), blk('b2')])).toEqual([])
  })
})

describe('appendVerbatimCoverage', () => {
  const order = ['b0', 'b1', 'b2', 'b3', 'b4']

  it('appends a verbatim paragraph for a dropped block to its nearest section', () => {
    const a = article([
      section('s0', ['b0'], [para('p0', ['b0'])]),
      section('s1', ['b4'], [para('p1', ['b4'])]),
    ])
    const out = appendVerbatimCoverage(a, [blk('b1'), blk('b3')], order)
    // b1 (idx1) → nearest b0 (s0); b3 (idx3) → nearest b4 (s1).
    const added0 = out.sections[0].blocks.at(-1) as ArticleParagraphBlock
    expect(added0.type).toBe('paragraph')
    expect(added0.text).toBe('text-b1') // the source block's own text, verbatim
    expect(added0.sourceBlockIds).toEqual(['b1'])
    expect(added0.transformationType).toBe('verbatim')
    expect(added0.fidelityRisk).toBe('low')
    const added1 = out.sections[1].blocks.at(-1) as ArticleParagraphBlock
    expect(added1.sourceBlockIds).toEqual(['b3'])
  })

  it('leaves nothing uncovered afterwards', () => {
    const a = article([section('s0', ['b0'], [para('p0', ['b0'])])])
    const all = [blk('b0'), blk('b1'), blk('b2')]
    const out = appendVerbatimCoverage(
      a,
      findUncoveredSourceBlocks(a, all),
      order,
    )
    expect(findUncoveredSourceBlocks(out, all)).toEqual([])
  })

  it('does not mutate the input article', () => {
    const a = article([section('s0', ['b0'], [para('p0', ['b0'])])])
    appendVerbatimCoverage(a, [blk('b1')], order)
    expect(a.sections[0].blocks).toHaveLength(1)
  })
})
