import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 12 — hybrid. Definitions + narrative + a procedure in one piece, and
 * the catch-all for the rarer block types. Exercises: a FIGURE ANCHOR block, an
 * inline CALLOUT block, an ordered list, plus a valid readingAids block (toc +
 * reading time + a source-grounded highlight) so the highlight traceability
 * path is covered positively (the negative case lives in unsupported-highlight).
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Setting up continuous deployment',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Continuous deployment ships every passing commit to production automatically.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'FIGURE',
    classification: 'SUPPORTING',
    text: 'Diagram: commit flows through CI to production.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'LIST',
    classification: 'CORE',
    text: 'Add a pipeline file.\nGate merges on green tests.\nDeploy from the main branch.',
    removable: false,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Note: keep a one-click rollback ready before you enable automatic deploys.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Setting up continuous deployment', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'Continuous deployment ships every passing commit to production automatically.',
      sourceBlockIds: ['b2'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Setting up continuous deployment',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Continuous deployment ships every passing commit to production automatically.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'fa1',
          type: 'figureAnchor',
          caption: 'How a commit flows through CI to production.',
          sourceBlockIds: ['b3'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'l1',
          type: 'list',
          ordered: true,
          items: [
            'Add a pipeline file.',
            'Gate merges on green tests.',
            'Deploy from the main branch.',
          ],
          sourceBlockIds: ['b4'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'co1',
          type: 'callout',
          calloutType: 'note',
          title: 'Note',
          text: 'Keep a one-click rollback ready before you enable automatic deploys.',
          sourceBlockIds: ['b5'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [{ term: 'Continuous deployment', sourceBlockIds: ['b2'] }],
  sourceExamples: [],
  caveats: [
    {
      text: 'Keep a one-click rollback ready before you enable automatic deploys.',
      sourceBlockIds: ['b5'],
    },
  ],
  originalStructure: [
    {
      blockId: 'b1',
      blockType: 'HEADING',
      preview: 'Setting up continuous deployment',
    },
    { blockId: 'b4', blockType: 'LIST', preview: 'Add a pipeline file…' },
  ],
  readingAids: {
    toc: [
      {
        sectionId: 's1',
        heading: 'Setting up continuous deployment',
        level: 1,
      },
    ],
    readingTimeMinutes: 1,
    sourceHighlights: [
      {
        text: 'Continuous deployment ships every passing commit to production automatically.',
        sourceBlockIds: ['b2'],
      },
    ],
  },
}

export const hybrid: V2Fixture = {
  name: 'hybrid',
  blocks,
  article,
}
