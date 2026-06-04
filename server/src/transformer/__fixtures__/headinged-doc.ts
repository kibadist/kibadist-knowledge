import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 9 — headinged-doc. A document with an H2/H3 hierarchy. Exercises: a
 * top-level section with one level of NESTED subsections (the H3s), each
 * grounded in its own source blocks; original heading provenance throughout.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Authentication',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The service supports two authentication mechanisms.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'HEADING',
    classification: 'CORE',
    text: 'API keys',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'API keys are long-lived secrets passed in the Authorization header.',
    removable: false,
  },
  {
    id: 'b5',
    type: 'HEADING',
    classification: 'CORE',
    text: 'OAuth tokens',
    removable: false,
  },
  {
    id: 'b6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'OAuth tokens are short-lived and obtained through the authorization code flow.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Authentication', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'The service supports two authentication mechanisms: API keys and OAuth tokens.',
      sourceBlockIds: ['b2'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Authentication',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sourceBlockIds: ['b1', 'b2'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'The service supports two authentication mechanisms.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
      subsections: [
        {
          id: 's1a',
          heading: 'API keys',
          headingSource: 'original',
          headingSourceBlockIds: ['b3'],
          sourceBlockIds: ['b3', 'b4'],
          blocks: [
            {
              id: 'p2',
              type: 'paragraph',
              text: 'API keys are long-lived secrets passed in the Authorization header.',
              sourceBlockIds: ['b4'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
            },
          ],
        },
        {
          id: 's1b',
          heading: 'OAuth tokens',
          headingSource: 'original',
          headingSourceBlockIds: ['b5'],
          sourceBlockIds: ['b5', 'b6'],
          blocks: [
            {
              id: 'p3',
              type: 'paragraph',
              text: 'OAuth tokens are short-lived and obtained through the authorization code flow.',
              sourceBlockIds: ['b6'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
            },
          ],
        },
      ],
    },
  ],
  keyTerms: [
    { term: 'API key', sourceBlockIds: ['b4'] },
    { term: 'OAuth token', sourceBlockIds: ['b6'] },
  ],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    { blockId: 'b1', blockType: 'HEADING', preview: 'Authentication' },
    { blockId: 'b3', blockType: 'HEADING', preview: 'API keys' },
    { blockId: 'b5', blockType: 'HEADING', preview: 'OAuth tokens' },
  ],
}

export const headingedDoc: V2Fixture = {
  name: 'headinged-doc',
  blocks,
  article,
}
