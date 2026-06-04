import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 7 — table-heavy. A comparison page whose payload is a table.
 * Exercises: a TABLE block (caption + header + rows) as the SOLE cited
 * representation of one source block, so coverage must count a table-only-cited
 * block as represented.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Storage tier comparison',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The three tiers trade durability against cost per gigabyte.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'TABLE',
    classification: 'CORE',
    text: 'Tier | Durability | Cost/GB\nHot | 99.999% | $0.023\nWarm | 99.99% | $0.010\nCold | 99.9% | $0.004',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Storage tier comparison', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'The three storage tiers trade durability against cost per gigabyte.',
      sourceBlockIds: ['b2'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Storage tier comparison',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2', 'b3'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'The three tiers trade durability against cost per gigabyte.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 't1',
          type: 'table',
          caption: 'Durability and cost by storage tier',
          header: ['Tier', 'Durability', 'Cost/GB'],
          rows: [
            ['Hot', '99.999%', '$0.023'],
            ['Warm', '99.99%', '$0.010'],
            ['Cold', '99.9%', '$0.004'],
          ],
          sourceBlockIds: ['b3'],
          transformationType: 'formatting_only',
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
      blockId: 'b3',
      blockType: 'TABLE',
      preview: 'Tier | Durability | Cost/GB',
    },
  ],
}

export const tableHeavy: V2Fixture = {
  name: 'table-heavy',
  blocks,
  article,
}
