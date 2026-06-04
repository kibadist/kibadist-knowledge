import { buildReadingAids } from './reading-aids.util'
import type { SourceStructureModel } from './schemas'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleSectionV2,
} from './transformer.types'

/** A paragraph block. */
const para = (
  id: string,
  text: string,
  ids: string[],
  transformationType: ArticleBlock['transformationType'] = 'verbatim',
): ArticleBlock => ({
  id,
  type: 'paragraph',
  text,
  sourceBlockIds: ids,
  transformationType,
  fidelityRisk: 'low',
})

/** A v2 section with the supplied blocks + optional subsections. */
function section(
  id: string,
  heading: string,
  blocks: ArticleBlock[],
  extra: Partial<ArticleSectionV2> = {},
): ArticleSectionV2 {
  return {
    id,
    heading,
    headingSource: 'original',
    sourceBlockIds: ['b1'],
    blocks,
    ...extra,
  }
}

/** A minimal valid v2 article. */
function article(
  sections: ArticleSectionV2[],
  extra: Partial<ArticleJsonV2> = {},
): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'Title', source: 'original' },
    abstract: [],
    sections,
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    ...extra,
  }
}

/** A structure model carrying the supplied claims (rest empty). */
function structureModel(
  claims: { text: string; sourceBlockIds: string[] }[],
): SourceStructureModel {
  return {
    title: null,
    subtitle: null,
    claims,
    definitions: [],
    examples: [],
    caveats: [],
    terminology: [],
    originalOutline: [],
    noiseDecisions: [],
    uncertainBlockIds: [],
  }
}

describe('buildReadingAids — TOC', () => {
  it('builds a flat TOC from top-level sections in document order', () => {
    const a = article([
      section('s1', 'First', [para('p1', 'x', ['b1'])]),
      section('s2', 'Second', [para('p2', 'y', ['b2'])]),
    ])
    const aids = buildReadingAids(a, null)
    expect(aids?.toc).toEqual([
      { sectionId: 's1', heading: 'First', headingSource: 'original' },
      { sectionId: 's2', heading: 'Second', headingSource: 'original' },
    ])
  })

  it('nests one level of subsection children with their heading source', () => {
    const a = article([
      section('s1', 'Parent', [para('p1', 'x', ['b1'])], {
        subsections: [
          section('s1a', 'Child', [para('p2', 'y', ['b2'])], {
            headingSource: 'inferred',
          }),
        ],
      }),
    ])
    const aids = buildReadingAids(a, null)
    expect(aids?.toc[0].children).toEqual([
      { sectionId: 's1a', heading: 'Child', headingSource: 'inferred' },
    ])
  })
})

describe('buildReadingAids — reading time', () => {
  it('counts title + subtitle + abstract + headings + every block, once for end-matter', () => {
    // title: 1 ("Title"). heading "H one" = 2. paragraph "alpha beta gamma" = 3.
    // list items "uno dos" + "tres" = 3. keyTerm "kterm" = 1. caveat "cv text" = 2.
    // total = 1 + 2 + 3 + 3 + 1 + 2 = 12 words.
    const list: ArticleBlock = {
      id: 'l1',
      type: 'list',
      ordered: false,
      items: ['uno dos', 'tres'],
      sourceBlockIds: ['b1'],
      transformationType: 'formatting_only',
      fidelityRisk: 'low',
    }
    const a = article(
      [section('s1', 'H one', [para('p1', 'alpha beta gamma', ['b1']), list])],
      {
        keyTerms: [{ term: 'kterm', sourceBlockIds: ['b1'] }],
        caveats: [{ text: 'cv text', sourceBlockIds: ['b1'] }],
      },
    )
    const aids = buildReadingAids(a, null)
    expect(aids?.readingTime.wordCount).toBe(12)
  })

  it('does not double-count callout placement metadata', () => {
    const a = article(
      [section('s1', 'H', [para('p1', 'one two three', ['b1'])])],
      {
        // The placement is a REFERENCE to the same caveat content; reading time
        // counts the top-level caveat ONCE and never the placement copy.
        caveats: [{ text: 'four five', sourceBlockIds: ['b1'] }],
        calloutPlacements: {
          bySection: {
            s1: [
              {
                id: 'co-caveat-0',
                kind: 'caveat',
                text: 'four five',
                sourceBlockIds: ['b1'],
                placementReason: "1/1 source block overlap section 'H'",
              },
            ],
          },
          unplaced: [],
        },
      },
    )
    // title 1 + heading 1 + paragraph 3 + caveat 2 = 7 (placement not counted).
    expect(buildReadingAids(a, null)?.readingTime.wordCount).toBe(7)
  })

  it('rounds to the nearest minute at 220 wpm', () => {
    // 330 words / 220 = 1.5 → rounds to 2.
    const words = Array.from({ length: 330 }, (_, i) => `w${i}`).join(' ')
    const a = article([section('s1', '', [para('p1', words, ['b1'])])])
    expect(buildReadingAids(a, null)?.readingTime.minutes).toBe(2)
  })

  it('enforces a minimum of 1 minute for short articles', () => {
    const a = article([section('s1', 'H', [para('p1', 'tiny', ['b1'])])])
    expect(buildReadingAids(a, null)?.readingTime.minutes).toBe(1)
  })
})

describe('buildReadingAids — highlights from claims', () => {
  it('selects up to 4 claims in source order whose ids are all represented', () => {
    const a = article([
      section('s1', 'H', [para('p1', 'x', ['b1', 'b2'])]),
      section('s2', 'H2', [para('p2', 'y', ['b3'])]),
    ])
    const sm = structureModel([
      { text: 'claim A', sourceBlockIds: ['b1'] },
      { text: 'claim B', sourceBlockIds: ['b2', 'b3'] },
      { text: 'claim C', sourceBlockIds: ['b1', 'b2', 'b3', 'b4', 'b5'] },
    ])
    const aids = buildReadingAids(a, sm)
    // claim A (b1) and claim B (b2,b3) are fully represented; claim C cites
    // unrepresented b4/b5 and is skipped.
    expect(aids?.highlights).toEqual([
      { text: 'claim A', sourceBlockIds: ['b1'] },
      { text: 'claim B', sourceBlockIds: ['b2', 'b3'] },
    ])
  })

  it('caps the number of highlights at 4', () => {
    const a = article([
      section('s1', 'H', [para('p1', 'x', ['b1', 'b2', 'b3', 'b4', 'b5'])]),
    ])
    const sm = structureModel(
      Array.from({ length: 6 }, (_, i) => ({
        text: `claim ${i}`,
        sourceBlockIds: ['b1'],
      })),
    )
    expect(buildReadingAids(a, sm)?.highlights).toHaveLength(4)
  })
})

describe('buildReadingAids — fallback to leading paragraphs', () => {
  it('uses the first sentence of a verbatim section-leading paragraph when no claim is usable', () => {
    const a = article([
      section('s1', 'H', [
        para('p1', 'First sentence here. Second sentence ignored.', ['b1']),
      ]),
    ])
    // No structure model → fallback path.
    const aids = buildReadingAids(a, null)
    expect(aids?.highlights).toEqual([
      { text: 'First sentence here.', sourceBlockIds: ['b1'] },
    ])
  })

  it('skips sections whose leading paragraph is more heavily transformed', () => {
    const a = article([
      section('s1', 'H', [
        para('p1', 'Reworded lede.', ['b1'], 'light_reword'),
      ]),
      section('s2', 'H2', [
        para('p2', 'Cleaned lede.', ['b2'], 'grammar_cleanup'),
      ]),
    ])
    const aids = buildReadingAids(a, null)
    // s1's light_reword lede is skipped; s2's grammar_cleanup lede is kept.
    expect(aids?.highlights).toEqual([
      { text: 'Cleaned lede.', sourceBlockIds: ['b2'] },
    ])
  })

  it('omits the highlights field entirely when no safe highlight survives', () => {
    const a = article([
      section('s1', 'H', [para('p1', 'Reworded.', ['b1'], 'light_reword')]),
    ])
    const aids = buildReadingAids(a, null)
    expect(aids).toBeDefined()
    expect(aids?.toc).toHaveLength(1)
    expect(aids?.readingTime.minutes).toBeGreaterThanOrEqual(1)
    expect(aids?.highlights).toBeUndefined()
  })

  it('falls back to leading paragraphs when the structure model has no usable claim', () => {
    const a = article([
      section('s1', 'H', [para('p1', 'Verbatim lede.', ['b1'])]),
    ])
    // The only claim cites an unrepresented block, so no claim is usable.
    const sm = structureModel([{ text: 'orphan', sourceBlockIds: ['bX'] }])
    expect(buildReadingAids(a, sm)?.highlights).toEqual([
      { text: 'Verbatim lede.', sourceBlockIds: ['b1'] },
    ])
  })
})
