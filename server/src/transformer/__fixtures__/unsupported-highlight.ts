import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * NEGATIVE fixture — unsupported-highlight. A valid v2 article whose
 * `readingAids.sourceHighlights` entry references a block id (`b999`) the source
 * does NOT contain. The shape is schema-valid (sourceBlockIds is non-empty), so
 * `ArticleJsonV2Schema.parse` SUCCEEDS — but the traceability walk
 * (`findUnknownSourceBlockIds`) flags `b999` as untraceable. The spec asserts
 * exactly that split: schema accepts the shape, the walk catches the bad id.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'TCP congestion control',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'TCP slows its sending rate when it detects packet loss.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'TCP congestion control', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'TCP slows its sending rate when it detects packet loss.',
      sourceBlockIds: ['b2'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'TCP congestion control',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'TCP slows its sending rate when it detects packet loss.',
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
      blockType: 'PARAGRAPH',
      preview: 'TCP slows its sending rate when it detects packet loss.',
    },
  ],
  readingAids: {
    sourceHighlights: [
      {
        // b999 does not exist among the source blocks — an untraceable highlight.
        text: 'A highlight not grounded in any real source block.',
        sourceBlockIds: ['b999'],
      },
    ],
  },
}

/** The id the traceability walk must flag. */
export const UNSUPPORTED_HIGHLIGHT_UNKNOWN_ID = 'b999'

export const unsupportedHighlight: V2Fixture = {
  name: 'unsupported-highlight',
  blocks,
  article,
}
