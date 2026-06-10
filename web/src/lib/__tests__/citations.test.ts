import { describe, expect, it } from 'vitest'

import type { InlineRun } from '@/lib/api'
import type { ArticleBlockV2, ArticleSectionV2, ArticleV2 } from '../article-v2'
import { ARTICLE_JSON_V2 } from '../article-v2'
import { buildCitationIndex } from '../citations'

function run(text: string): InlineRun[] {
  return [{ text }]
}
function para(
  id: string,
  text: string,
  sourceSpanIds?: string[],
): ArticleBlockV2 {
  return {
    block_id: id,
    section_id: '',
    order_index: 0,
    type: 'paragraph',
    content: { runs: run(text) },
    source_span_ids: sourceSpanIds,
  }
}
function section(
  id: string,
  blocks: ArticleBlockV2[],
  order = 0,
): ArticleSectionV2 {
  return {
    section_id: id,
    heading: id,
    order_index: order,
    blocks: blocks.map((b, i) => ({ ...b, section_id: id, order_index: i })),
  }
}
function article(sections: ArticleSectionV2[]): ArticleV2 {
  return {
    article_id: 'a1',
    source_id: 's1',
    schema_version: ARTICLE_JSON_V2,
    title: 'T',
    generated_at: '2026-01-01T00:00:00Z',
    sections,
  }
}

describe('buildCitationIndex', () => {
  it('numbers distinct source blocks in first-appearance reading order', () => {
    const index = buildCitationIndex(
      article([
        section(
          'sec-1',
          [
            para('b1', 'One.', ['src-b', 'src-a']),
            para('b2', 'Two.', ['src-c']),
          ],
          0,
        ),
        section('sec-2', [para('b3', 'Three.', ['src-a', 'src-d'])], 1),
      ]),
    )
    expect(index.orderedSourceIds).toEqual(['src-b', 'src-a', 'src-c', 'src-d'])
    expect(index.numberBySourceId.get('src-b')).toBe(1)
    expect(index.numberBySourceId.get('src-a')).toBe(2)
    expect(index.numberBySourceId.get('src-d')).toBe(4)
  })

  it('reuses the same number when a source block is cited again', () => {
    const index = buildCitationIndex(
      article([
        section('sec-1', [
          para('b1', 'One.', ['src-a']),
          para('b2', 'Two.', ['src-a', 'src-b']),
        ]),
      ]),
    )
    expect(index.orderedSourceIds).toEqual(['src-a', 'src-b'])
    expect(index.numbersByBlockId.get('b1')).toEqual([1])
    expect(index.numbersByBlockId.get('b2')).toEqual([1, 2])
  })

  it('dedupes repeated ids within one block and sorts its numbers', () => {
    const index = buildCitationIndex(
      article([
        section('sec-1', [
          para('b1', 'One.', ['src-a']),
          para('b2', 'Two.', ['src-b', 'src-a', 'src-b']),
        ]),
      ]),
    )
    expect(index.numbersByBlockId.get('b2')).toEqual([1, 2])
  })

  it('never fabricates citations: an unreferenced block has no entry', () => {
    const index = buildCitationIndex(
      article([section('sec-1', [para('b1', 'One.'), para('b2', 'Two.', [])])]),
    )
    expect(index.orderedSourceIds).toEqual([])
    expect(index.numbersByBlockId.has('b1')).toBe(false)
    expect(index.numbersByBlockId.has('b2')).toBe(false)
  })

  it('follows persisted order, not array order', () => {
    const secondFirst = article([
      section('sec-2', [para('b2', 'Two.', ['src-b'])], 1),
      section('sec-1', [para('b1', 'One.', ['src-a'])], 0),
    ])
    const index = buildCitationIndex(secondFirst)
    expect(index.orderedSourceIds).toEqual(['src-a', 'src-b'])
  })
})
