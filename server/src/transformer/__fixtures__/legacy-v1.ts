import type { ClassifiedBlockInput } from '../structure-model.service'
import type { SourcePreservingArticle } from '../transformer.types'
import type { V1Fixture } from './index'

/**
 * Legacy fixture — a paragraph-only v1 `SourcePreservingArticle` exactly as
 * older stored rows look (NO schemaVersion). The spec asserts `toArticleV2`
 * adapts it, the adapted form schema-validates, and its coverage report is
 * identical to computing coverage directly on the v1 value.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'The water cycle',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Water evaporates from oceans and lakes, rises, and cools into clouds.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'It then falls as precipitation and flows back to the sea, completing the cycle.',
    removable: false,
  },
]

const article: SourcePreservingArticle = {
  mode: 'source_preserving_article',
  title: { text: 'The water cycle', source: 'original' },
  subtitle: {
    text: 'A continuous movement of water on Earth',
    source: 'light_reword',
    sourceBlockIds: ['b2'],
  },
  abstract: [
    {
      id: 'a1',
      text: 'Water moves continuously between the oceans, atmosphere, and land.',
      sourceBlockIds: ['b2', 'b3'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'The water cycle',
      headingSource: 'original',
      sourceBlockIds: ['b1', 'b2', 'b3'],
      paragraphs: [
        {
          id: 'p1',
          text: 'Water evaporates from oceans and lakes, rises, and cools into clouds.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          text: 'It then falls as precipitation and flows back to the sea, completing the cycle.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [{ term: 'Precipitation', sourceBlockIds: ['b3'] }],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    { blockId: 'b1', blockType: 'HEADING', preview: 'The water cycle' },
  ],
}

export const articleV1Legacy: V1Fixture = {
  name: 'article.v1',
  blocks,
  article,
}
