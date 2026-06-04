import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 8 — quote-heavy. An interview piece built around attributed quotes.
 * Exercises: QUOTE blocks WITH attribution, a PULLQUOTE block (display excerpt
 * of real source text), connective prose.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'On building durable teams',
    removable: false,
  },
  {
    id: 'b2',
    type: 'QUOTE',
    classification: 'CORE',
    text: 'The best teams are not the most talented, they are the most aligned.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'She returned to that point repeatedly when describing the early years.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'QUOTE',
    classification: 'CORE',
    text: 'We hired slowly and fired even more slowly than we should have.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'On building durable teams', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'In her own words, durable teams are built on alignment more than raw talent.',
      sourceBlockIds: ['b2'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'On building durable teams',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
      blocks: [
        {
          id: 'q1',
          type: 'quote',
          text: 'The best teams are not the most talented, they are the most aligned.',
          attribution: 'Ada Okonkwo',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p1',
          type: 'paragraph',
          text: 'She returned to that point repeatedly when describing the early years.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'q2',
          type: 'quote',
          text: 'We hired slowly and fired even more slowly than we should have.',
          attribution: 'Ada Okonkwo',
          sourceBlockIds: ['b4'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'pq1',
          type: 'pullQuote',
          text: 'The best teams are not the most talented, they are the most aligned.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    {
      blockId: 'b2',
      blockType: 'QUOTE',
      preview: 'The best teams are not the most talented…',
    },
  ],
}

export const quoteHeavy: V2Fixture = {
  name: 'quote-heavy',
  blocks,
  article,
}
