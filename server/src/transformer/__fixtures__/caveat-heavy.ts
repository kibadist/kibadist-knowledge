import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 10 — caveat-heavy. A safety-sensitive note with several disclaimers.
 * Exercises: multiple top-level caveats (each traceable) plus an inline CALLOUT
 * block for a distinct source warning box; body paragraph.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Dosing guidance',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The standard adult dose is 200 mg taken twice daily with food.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Do not exceed 600 mg in any 24-hour period.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'This guidance does not apply to patients with reduced kidney function.',
    removable: false,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Warning: combining with alcohol increases the risk of stomach bleeding.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Dosing guidance', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'The standard adult dose is 200 mg twice daily with food, subject to several limits.',
      sourceBlockIds: ['b2'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Dosing guidance',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2', 'b5'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'The standard adult dose is 200 mg taken twice daily with food.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'co1',
          type: 'callout',
          calloutType: 'warning',
          title: 'Warning',
          text: 'Combining with alcohol increases the risk of stomach bleeding.',
          sourceBlockIds: ['b5'],
          transformationType: 'light_reword',
          fidelityRisk: 'medium',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [
    {
      text: 'Do not exceed 600 mg in any 24-hour period.',
      sourceBlockIds: ['b3'],
    },
    {
      text: 'This guidance does not apply to patients with reduced kidney function.',
      sourceBlockIds: ['b4'],
    },
  ],
  originalStructure: [
    {
      blockId: 'b3',
      blockType: 'PARAGRAPH',
      preview: 'Do not exceed 600 mg in any 24-hour period.',
    },
  ],
}

export const caveatHeavy: V2Fixture = {
  name: 'caveat-heavy',
  blocks,
  article,
}
