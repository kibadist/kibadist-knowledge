import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 1 — wikipedia-explainer. A plain encyclopedic explainer: heading +
 * lede + two body paragraphs + a key term + an "edit" footer that is noise.
 * Exercises: paragraph blocks, original headings, keyTerms, a removed block.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Photosynthesis',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Photosynthesis is the process by which plants convert light energy into chemical energy stored in sugars.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'It occurs in the chloroplasts, where chlorophyll captures photons and drives the synthesis of glucose from carbon dioxide and water.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'SUPPORTING',
    text: 'Oxygen is released as a by-product of the light-dependent reactions.',
    removable: false,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'This article needs additional citations for verification. [edit]',
    removable: true,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'explainer',
  title: { text: 'Photosynthesis', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'Photosynthesis is how plants convert light energy into chemical energy stored in sugars.',
      sourceBlockIds: ['b2'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Photosynthesis',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sectionRole: 'definition',
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Photosynthesis is the process by which plants convert light energy into chemical energy stored in sugars.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'It occurs in the chloroplasts, where chlorophyll captures photons and drives the synthesis of glucose from carbon dioxide and water.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Oxygen is released as a by-product of the light-dependent reactions.',
          sourceBlockIds: ['b4'],
          transformationType: 'grammar_cleanup',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [
    { term: 'Chloroplast', sourceBlockIds: ['b3'] },
    { term: 'Chlorophyll', sourceBlockIds: ['b3'] },
  ],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    { blockId: 'b1', blockType: 'HEADING', preview: 'Photosynthesis' },
    {
      blockId: 'b2',
      blockType: 'PARAGRAPH',
      preview: 'Photosynthesis is the process by which plants convert light…',
    },
  ],
}

export const wikipediaExplainer: V2Fixture = {
  name: 'wikipedia-explainer',
  blocks,
  article,
}
