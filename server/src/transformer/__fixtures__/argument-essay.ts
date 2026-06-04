import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 3 — argument-essay. A claim supported by evidence and qualified by a
 * caveat. Exercises: claim/evidence paragraphs, a caveat carried in the
 * top-level caveats array (the unit a later reorder check must keep adjacent).
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Remote work raises focus time',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Remote work increases the amount of uninterrupted focus time available to knowledge workers.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A 2021 study of 3,000 engineers found a 22 percent rise in deep-work hours after going remote.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'However, the same study notes the effect disappears when meeting load is not also reduced.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Remote work raises focus time', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'Remote work increases uninterrupted focus time for knowledge workers — with one important condition.',
      sourceBlockIds: ['b2', 'b4'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'The claim',
      headingSource: 'inferred',
      sourceBlockIds: ['b1', 'b2'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Remote work increases the amount of uninterrupted focus time available to knowledge workers.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: 'The evidence',
      headingSource: 'inferred',
      sourceBlockIds: ['b3'],
      blocks: [
        {
          id: 'p2',
          type: 'paragraph',
          text: 'A 2021 study of 3,000 engineers found a 22 percent rise in deep-work hours after going remote.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [
    {
      text: 'A 2021 study of 3,000 engineers found a 22 percent rise in deep-work hours after going remote.',
      sourceBlockIds: ['b3'],
    },
  ],
  caveats: [
    {
      text: 'The effect disappears when meeting load is not also reduced.',
      sourceBlockIds: ['b4'],
    },
  ],
  originalStructure: [
    {
      blockId: 'b2',
      blockType: 'PARAGRAPH',
      preview: 'Remote work increases the amount of uninterrupted focus…',
    },
    {
      blockId: 'b4',
      blockType: 'PARAGRAPH',
      preview: 'However, the same study notes the effect disappears…',
    },
  ],
}

export const argumentEssay: V2Fixture = {
  name: 'argument-essay',
  blocks,
  article,
}
