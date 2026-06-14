import { buildSourceSegments, type SegmentBlock } from './source-segments.util'

/** Build a heading block. */
function heading(id: string, text: string, level = 2): SegmentBlock {
  return {
    id,
    type: 'HEADING',
    classification: 'CORE',
    text,
    headingLevel: level,
  }
}
/** Build a paragraph block. */
function para(id: string, text: string, classification = 'CORE'): SegmentBlock {
  return { id, type: 'PARAGRAPH', classification, text }
}

describe('buildSourceSegments', () => {
  it('returns [] for no blocks', () => {
    expect(buildSourceSegments([])).toEqual([])
  })

  it('makes a single content segment for a headingless transcript', () => {
    const segments = buildSourceSegments([
      para('b1', 'first sentence'),
      para('b2', 'second sentence'),
      para('b3', 'third sentence'),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      id: 'seg1',
      kind: 'content',
      blockIds: ['b1', 'b2', 'b3'],
    })
    expect(segments[0].headingText).toBeUndefined()
  })

  it('opens a new segment at every heading and carries the heading text', () => {
    const segments = buildSourceSegments([
      heading('h1', 'What Is a System'),
      para('b1', 'A system is a set of interacting parts.'),
      heading('h2', 'Boundaries and Environment'),
      para('b2', 'A boundary separates a system from its environment.'),
    ])
    expect(segments.map((s) => s.headingText)).toEqual([
      'What Is a System',
      'Boundaries and Environment',
    ])
    expect(segments[0].blockIds).toEqual(['h1', 'b1'])
    expect(segments[0].headingBlockId).toBe('h1')
    expect(segments[1].blockIds).toEqual(['h2', 'b2'])
  })

  it('labels references / bibliography / external-links headings as source furniture', () => {
    const segments = buildSourceSegments([
      heading('h1', 'Overview'),
      para('b1', 'Body text.'),
      heading('h2', 'References'),
      para('b2', '[1] Some citation.', 'CITATION'),
      heading('h3', 'Bibliography'),
      para('b3', 'Author, Title.', 'CITATION'),
      heading('h4', 'External links'),
      para('b4', 'http://example.com', 'CITATION'),
    ])
    const byHeading = Object.fromEntries(
      segments.map((s) => [s.headingText, s.kind]),
    )
    expect(byHeading.Overview).toBe('content')
    expect(byHeading.References).toBe('references')
    expect(byHeading.Bibliography).toBe('bibliography')
    expect(byHeading['External links']).toBe('externalLinks')
  })

  it('strips a trailing [edit] marker before matching a furniture heading', () => {
    const segments = buildSourceSegments([
      heading('h1', 'References [edit]'),
      para('b1', '[1] cite', 'CITATION'),
    ])
    expect(segments[0].kind).toBe('references')
    expect(segments[0].headingText).toBe('References')
  })

  it('detects a citation-dominated segment under a generic heading', () => {
    const segments = buildSourceSegments([
      heading('h1', 'Notes and sources'),
      para('b1', '[1] cite one', 'CITATION'),
      para('b2', '[2] cite two', 'CITATION'),
    ])
    expect(segments[0].kind).toBe('citations')
  })
})
