import { isArticleV2, toArticleV2 } from './article-compat.util'
import type { ArticleJsonV2, SourcePreservingArticle } from './transformer.types'

function v1(
  partial: Partial<SourcePreservingArticle> = {},
): SourcePreservingArticle {
  return {
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections: [],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    ...partial,
  }
}

describe('article-compat: toArticleV2', () => {
  it('stamps schemaVersion v2 and keeps mode', () => {
    const out = toArticleV2(v1())
    expect(out.schemaVersion).toBe('v2')
    expect(out.mode).toBe('source_preserving_article')
  })

  it('converts v1 paragraphs into paragraph blocks, preserving every field', () => {
    const out = toArticleV2(
      v1({
        sections: [
          {
            id: 's1',
            heading: 'H',
            headingSource: 'original',
            sourceBlockIds: ['b1'],
            paragraphs: [
              {
                id: 'p1',
                text: 'hello',
                sourceBlockIds: ['b1', 'b2'],
                transformationType: 'light_reword',
                fidelityRisk: 'medium',
              },
            ],
          },
        ],
      }),
    )
    const block = out.sections[0].blocks[0]
    expect(block).toEqual({
      id: 'p1',
      type: 'paragraph',
      text: 'hello',
      sourceBlockIds: ['b1', 'b2'],
      transformationType: 'light_reword',
      fidelityRisk: 'medium',
    })
    expect(out.sections[0]).not.toHaveProperty('paragraphs')
  })

  it('maps v1 heading provenance onto the v2 naming', () => {
    const out = toArticleV2(
      v1({
        title: { text: 'T', source: 'light_reword' },
        subtitle: {
          text: 'S',
          source: 'inferred_from_source',
          sourceBlockIds: ['b1'],
        },
        sections: [
          {
            id: 's1',
            heading: 'original heading',
            headingSource: 'original',
            sourceBlockIds: ['b1'],
            paragraphs: [],
          },
          {
            id: 's2',
            heading: 'reworded heading',
            headingSource: 'light_reword',
            sourceBlockIds: ['b2'],
            paragraphs: [],
          },
          {
            id: 's3',
            heading: 'inferred heading',
            headingSource: 'inferred_from_source',
            sourceBlockIds: ['b3'],
            paragraphs: [],
          },
        ],
      }),
    )
    expect(out.title.source).toBe('cleanedOriginal')
    expect(out.subtitle?.source).toBe('inferred')
    expect(out.sections.map((s) => s.headingSource)).toEqual([
      'original',
      'cleanedOriginal',
      'inferred',
    ])
  })

  it('carries abstract / keyTerms / sourceExamples / caveats / originalStructure verbatim', () => {
    const source = v1({
      abstract: [
        {
          id: 'a1',
          text: 'abs',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
      keyTerms: [{ term: 'K', sourceBlockIds: ['b1'] }],
      sourceExamples: [{ text: 'EX', sourceBlockIds: ['b2'] }],
      caveats: [{ text: 'CV', sourceBlockIds: ['b3'] }],
      originalStructure: [{ blockId: 'b1', blockType: 'PARAGRAPH', preview: 'p' }],
    })
    const out = toArticleV2(source)
    expect(out.abstract).toEqual(source.abstract)
    expect(out.keyTerms).toEqual(source.keyTerms)
    expect(out.sourceExamples).toEqual(source.sourceExamples)
    expect(out.caveats).toEqual(source.caveats)
    expect(out.originalStructure).toEqual(source.originalStructure)
  })

  it('is idempotent: toArticleV2 of a v2 article returns it unchanged', () => {
    const once = toArticleV2(v1())
    const twice = toArticleV2(once)
    expect(twice).toBe(once)
    expect(twice).toEqual(once)
  })

  it('is a pure read-time adapter: it does not mutate the v1 input', () => {
    const source = v1({
      sections: [
        {
          id: 's1',
          heading: 'H',
          headingSource: 'original',
          sourceBlockIds: ['b1'],
          paragraphs: [
            {
              id: 'p1',
              text: 'x',
              sourceBlockIds: ['b1'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
            },
          ],
        },
      ],
    })
    const snapshot = JSON.parse(JSON.stringify(source))
    toArticleV2(source)
    expect(source).toEqual(snapshot)
  })
})

describe('article-compat: isArticleV2', () => {
  it('is false for v1 (no schemaVersion) and true for v2', () => {
    expect(isArticleV2(v1())).toBe(false)
    const out: ArticleJsonV2 = toArticleV2(v1())
    expect(isArticleV2(out)).toBe(true)
  })
})
