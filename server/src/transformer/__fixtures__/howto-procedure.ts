import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 2 — howto-procedure. A task with ordered steps. Exercises: an ORDERED
 * list block (steps must stay ordered), an intro paragraph, a closing caveat, and
 * the genre shape 'procedure' with a 'step'-role section (DET-273). The procedure
 * fidelity check requires the source ORDERED list to stay a list block in order.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'How to brew pour-over coffee',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Pour-over coffee rewards a steady, repeatable routine.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'LIST',
    classification: 'CORE',
    text: 'Rinse the filter.\nAdd 20 g of ground coffee.\nBloom with 40 g of water for 30 seconds.\nPour to 300 g in slow circles.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'SUPPORTING',
    text: 'Water just off the boil, around 96 degrees Celsius, gives the cleanest extraction.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'procedure',
  title: { text: 'How to brew pour-over coffee', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'Pour-over coffee rewards a steady, repeatable routine.',
      sourceBlockIds: ['b2'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'How to brew pour-over coffee',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sectionRole: 'step',
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Pour-over coffee rewards a steady, repeatable routine.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'l1',
          type: 'list',
          ordered: true,
          items: [
            'Rinse the filter.',
            'Add 20 g of ground coffee.',
            'Bloom with 40 g of water for 30 seconds.',
            'Pour to 300 g in slow circles.',
          ],
          sourceBlockIds: ['b3'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Use water just off the boil, around 96 degrees Celsius, for the cleanest extraction.',
          sourceBlockIds: ['b4'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [
    {
      text: 'Water just off the boil, around 96 degrees Celsius, gives the cleanest extraction.',
      sourceBlockIds: ['b4'],
    },
  ],
  originalStructure: [
    {
      blockId: 'b1',
      blockType: 'HEADING',
      preview: 'How to brew pour-over coffee',
    },
    { blockId: 'b3', blockType: 'LIST', preview: 'Rinse the filter…' },
  ],
}

export const howtoProcedure: V2Fixture = {
  name: 'howto-procedure',
  blocks,
  article,
}
