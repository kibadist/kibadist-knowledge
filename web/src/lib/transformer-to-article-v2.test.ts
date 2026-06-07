import { describe, expect, it } from 'vitest'

import type { ArticleJsonV2 as TransformerArticle } from './api'
import { orderedSections } from './article-v2'
import { transformerArticleToV2 } from './transformer-to-article-v2'

// A compact transformer article exercising the shapes the adapter must handle:
// a separate abstract, a section with a subsection, several block types, and a
// placed key-term callout.
function makeTransformerArticle(): TransformerArticle {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'Spaced Repetition', source: 'original' },
    subtitle: {
      text: 'A working example',
      source: 'inferred',
      sourceBlockIds: [],
    },
    abstract: [
      {
        id: 'abs-1',
        text: 'A summary paragraph.',
        sourceBlockIds: ['s1'],
        transformationType: 'verbatim',
        fidelityRisk: 'low',
      },
    ],
    sections: [
      {
        id: 'sec-1',
        heading: 'How it works',
        headingSource: 'original',
        sourceBlockIds: ['s2'],
        blocks: [
          {
            id: 'b1',
            type: 'paragraph',
            text: 'The forgetting curve.',
            sourceBlockIds: ['s2'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
          {
            id: 'b2',
            type: 'list',
            ordered: true,
            items: ['First', 'Second'],
            sourceBlockIds: ['s3'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
          {
            id: 'b3',
            type: 'table',
            header: ['Day', 'Recall'],
            rows: [['1', '90%']],
            sourceBlockIds: ['s4'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
          {
            id: 'b4',
            type: 'figureAnchor',
            caption: 'A chart',
            sourceBlockIds: ['s5'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
        subsections: [
          {
            id: 'sec-1a',
            heading: 'Caveats',
            headingSource: 'original',
            sourceBlockIds: ['s6'],
            blocks: [
              {
                id: 'b5',
                type: 'paragraph',
                text: 'It depends on effort.',
                sourceBlockIds: ['s6'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      },
    ],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    calloutPlacements: {
      bySection: {
        'sec-1': [
          {
            id: 'kt-1',
            kind: 'keyTerm',
            term: 'forgetting curve',
            text: 'forgetting curve',
            sourceBlockIds: ['s2'],
            placementReason: 'overlap',
          },
        ],
      },
      unplaced: [],
    },
  }
}

describe('transformerArticleToV2', () => {
  const adapted = transformerArticleToV2(makeTransformerArticle(), {
    articleId: 'art-1',
    sourceId: 'src-1',
  })

  it('carries identity through and brands the learning contract', () => {
    expect(adapted.article_id).toBe('art-1')
    expect(adapted.source_id).toBe('src-1')
    expect(adapted.schema_version).toBe('article_json_v2')
    expect(adapted.title).toBe('Spaced Repetition')
  })

  it('lifts the abstract into a leading section and flattens subsections in order', () => {
    const sections = orderedSections(adapted)
    expect(sections.map((s) => s.section_id)).toEqual([
      'art-1-abstract',
      'sec-1',
      'sec-1a',
    ])
    expect(sections.map((s) => s.heading)).toEqual([
      'A working example',
      'How it works',
      'Caveats',
    ])
    // order_index is monotonic so the modes read top to bottom.
    expect(sections.map((s) => s.order_index)).toEqual([0, 1, 2])
  })

  it('converts text blocks to InlineRun content and drops figure anchors', () => {
    const sec = adapted.sections.find((s) => s.section_id === 'sec-1')
    if (!sec) throw new Error('section missing')
    // The figureAnchor has no readable body, so it is dropped.
    expect(sec.blocks.map((b) => b.block_id)).toEqual(['b1', 'b2', 'b3'])

    const [para, list, table] = sec.blocks
    expect(para).toMatchObject({
      type: 'paragraph',
      section_id: 'sec-1',
      order_index: 0,
      content: { runs: [{ text: 'The forgetting curve.' }] },
      source_span_ids: ['s2'],
    })
    expect(list).toMatchObject({
      type: 'list',
      content: {
        ordered: true,
        items: [[{ text: 'First' }], [{ text: 'Second' }]],
      },
    })
    // A header row is prepended and `header` flagged true.
    expect(table).toMatchObject({
      type: 'table',
      content: {
        header: true,
        rows: [
          ['Day', 'Recall'],
          ['1', '90%'],
        ],
      },
    })
  })

  it('surfaces placed key-term callouts as section key terms', () => {
    const sec = adapted.sections.find((s) => s.section_id === 'sec-1')
    expect(sec?.key_terms).toEqual([{ term: 'forgetting curve' }])
  })
})
