import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 11 — glossary-reference. A reference list of defined terms. Exercises:
 * an UNORDERED list block, many keyTerms (each traceable), and the genre shape
 * 'reference' with a term-led section carrying the 'referenceEntry' role (DET-273).
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Glossary of caching terms',
    removable: false,
  },
  {
    id: 'b2',
    type: 'LIST',
    classification: 'CORE',
    text: 'Cache hit: a request served from the cache.\nCache miss: a request not found in the cache.\nEviction: removing an entry to make room.\nTTL: how long an entry stays valid.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'SUPPORTING',
    text: 'These terms recur throughout the caching chapter.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'reference',
  title: { text: 'Glossary of caching terms', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'A short glossary of the caching terms used throughout the chapter.',
      sourceBlockIds: ['b3'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Glossary of caching terms',
      headingSource: 'original',
      headingSourceBlockIds: ['b1'],
      sectionRole: 'referenceEntry',
      sourceBlockIds: ['b1', 'b2', 'b3'],
      blocks: [
        {
          id: 'l1',
          type: 'list',
          ordered: false,
          items: [
            'Cache hit: a request served from the cache.',
            'Cache miss: a request not found in the cache.',
            'Eviction: removing an entry to make room.',
            'TTL: how long an entry stays valid.',
          ],
          sourceBlockIds: ['b2'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
        {
          id: 'p1',
          type: 'paragraph',
          text: 'These terms recur throughout the caching chapter.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [
    { term: 'Cache hit', sourceBlockIds: ['b2'] },
    { term: 'Cache miss', sourceBlockIds: ['b2'] },
    { term: 'Eviction', sourceBlockIds: ['b2'] },
    { term: 'TTL', sourceBlockIds: ['b2'] },
  ],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    {
      blockId: 'b2',
      blockType: 'LIST',
      preview: 'Cache hit: a request served…',
    },
  ],
}

export const glossaryReference: V2Fixture = {
  name: 'glossary-reference',
  blocks,
  article,
}
