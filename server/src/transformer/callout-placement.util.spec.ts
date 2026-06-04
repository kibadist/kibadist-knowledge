import { articleV1Legacy } from './__fixtures__/legacy-v1'
import { toArticleV2 } from './article-compat.util'
import { placeCallouts } from './callout-placement.util'
import type { ArticleJsonV2 } from './transformer.types'

/**
 * Inline callout placement (DET-272) — deterministic, NO LLM. We assert the
 * overlap rule (largest overlap wins, earliest section on ties), that a placed
 * callout carries a human-readable reason, that a zero-overlap item is unplaced,
 * keyTerm term-normalization, deterministic ids, subsection ids counted into the
 * parent, and that the same util runs over an ADAPTED legacy v1 article (the
 * getArticle read-boundary path).
 */

/** A minimal v2 article with two sections + supplied end-matter. */
function article(
  overrides: Partial<
    Pick<ArticleJsonV2, 'keyTerms' | 'sourceExamples' | 'caveats' | 'sections'>
  >,
): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections: [
      {
        id: 's1',
        heading: 'Alpha',
        headingSource: 'original',
        sourceBlockIds: ['b1', 'b2'],
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            text: 'a',
            sourceBlockIds: ['b1', 'b2'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
      },
      {
        id: 's2',
        heading: 'Beta',
        headingSource: 'original',
        sourceBlockIds: ['b3', 'b4'],
        blocks: [
          {
            id: 'p2',
            type: 'paragraph',
            text: 'b',
            sourceBlockIds: ['b3', 'b4'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
      },
    ],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    ...overrides,
  }
}

describe('placeCallouts', () => {
  it('places an item beside the section with the LARGEST source-block overlap', () => {
    const a = article({
      caveats: [{ text: 'Caveat for Beta', sourceBlockIds: ['b3', 'b4'] }],
    })
    const result = placeCallouts(a)
    expect(result.bySection.s2).toHaveLength(1)
    expect(result.bySection.s1).toBeUndefined()
    expect(result.unplaced).toEqual([])
  })

  it('breaks ties to the EARLIEST section in reading order', () => {
    // One overlapping id in each of s1 (b1) and s2 (b3): equal scores → s1 wins.
    const a = article({
      keyTerms: [{ term: 'Tie', sourceBlockIds: ['b1', 'b3'] }],
    })
    const result = placeCallouts(a)
    expect(result.bySection.s1).toHaveLength(1)
    expect(result.bySection.s2).toBeUndefined()
  })

  it('records a human-readable placementReason naming the heading and counts', () => {
    const a = article({
      caveats: [{ text: 'c', sourceBlockIds: ['b3', 'b4', 'bX'] }],
    })
    const result = placeCallouts(a)
    expect(result.bySection.s2[0].placementReason).toBe(
      "2/3 source blocks overlap section 'Beta'",
    )
  })

  it('singularizes the reason for a single-block item', () => {
    const a = article({
      caveats: [{ text: 'c', sourceBlockIds: ['b3'] }],
    })
    const result = placeCallouts(a)
    expect(result.bySection.s2[0].placementReason).toBe(
      "1/1 source block overlap section 'Beta'",
    )
  })

  it('leaves an item with ZERO overlap unplaced', () => {
    const a = article({
      sourceExamples: [{ text: 'orphan', sourceBlockIds: ['bZ'] }],
    })
    const result = placeCallouts(a)
    expect(result.bySection).toEqual({})
    expect(result.unplaced).toHaveLength(1)
    expect(result.unplaced[0].placementReason).toBe(
      'No source-block overlap with any section.',
    )
  })

  it('normalizes a keyTerm: `term` populated and mirrored into `text`', () => {
    const a = article({
      keyTerms: [{ term: 'Mitochondria', sourceBlockIds: ['b1'] }],
    })
    const placed = placeCallouts(a).bySection.s1[0]
    expect(placed.kind).toBe('keyTerm')
    expect(placed.term).toBe('Mitochondria')
    expect(placed.text).toBe('Mitochondria')
  })

  it('derives deterministic, index-based ids per kind', () => {
    const a = article({
      keyTerms: [
        { term: 'K0', sourceBlockIds: ['b1'] },
        { term: 'K1', sourceBlockIds: ['b1'] },
      ],
      sourceExamples: [{ text: 'E0', sourceBlockIds: ['b1'] }],
      caveats: [{ text: 'C0', sourceBlockIds: ['b1'] }],
    })
    const ids = placeCallouts(a).bySection.s1.map((c) => c.id)
    expect(ids).toEqual([
      'co-keyTerm-0',
      'co-keyTerm-1',
      'co-example-0',
      'co-caveat-0',
    ])
    // Running again yields the exact same ids (idempotent / no randomness).
    expect(placeCallouts(a).bySection.s1.map((c) => c.id)).toEqual(ids)
  })

  it('counts a SUBSECTION block`s ids into the parent section for placement', () => {
    const a = article({ caveats: [{ text: 'sub', sourceBlockIds: ['bSub'] }] })
    // Add a subsection under s1 that owns bSub; the caveat must land on s1.
    a.sections[0].subsections = [
      {
        id: 's1a',
        heading: 'Alpha child',
        headingSource: 'original',
        sourceBlockIds: ['bSub'],
        blocks: [
          {
            id: 'sp1',
            type: 'paragraph',
            text: 'sub body',
            sourceBlockIds: ['bSub'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
      },
    ]
    const result = placeCallouts(a)
    expect(result.bySection.s1).toHaveLength(1)
    expect(result.bySection.s1[0].text).toBe('sub')
  })

  it('runs over an ADAPTED legacy v1 article (getArticle read-boundary path)', () => {
    // The util consumes v2; getArticle adapts v1 first, then places. Mirror that.
    const adapted = toArticleV2(articleV1Legacy.article)
    const result = placeCallouts(adapted)
    // The placement is total: every end-matter item is either placed or unplaced.
    const placedCount = Object.values(result.bySection).reduce(
      (n, arr) => n + arr.length,
      0,
    )
    const endMatterCount =
      adapted.keyTerms.length +
      adapted.sourceExamples.length +
      adapted.caveats.length
    expect(placedCount + result.unplaced.length).toBe(endMatterCount)
  })
})
