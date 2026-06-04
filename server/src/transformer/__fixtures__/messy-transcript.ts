import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 5 — messy-transcript. A headingless spoken transcript with filler.
 * Exercises: ALL inferred headings (each grounded in section sourceBlockIds, so
 * the deterministic fidelity check does not flag them), filler removed as noise.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'Um, okay, so, yeah, hi everyone, can you hear me?',
    removable: true,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The main thing we shipped this quarter was the new onboarding flow.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Activation went up about fifteen percent after we cut the second signup step.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Next quarter we want to do the same simplification for the billing screens.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'hybrid',
  title: { text: 'Quarterly product update', source: 'inferred' },
  abstract: [
    {
      id: 'a1',
      text: 'The new onboarding flow shipped this quarter and lifted activation; billing is next.',
      sourceBlockIds: ['b2', 'b3', 'b4'],
      transformationType: 'light_reword',
      fidelityRisk: 'medium',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'What shipped',
      headingSource: 'inferred',
      sourceBlockIds: ['b2', 'b3'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'The main thing we shipped this quarter was the new onboarding flow.',
          sourceBlockIds: ['b2'],
          transformationType: 'grammar_cleanup',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Activation went up about fifteen percent after we cut the second signup step.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: "What's next",
      headingSource: 'inferred',
      sourceBlockIds: ['b4'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Next quarter we want to apply the same simplification to the billing screens.',
          sourceBlockIds: ['b4'],
          transformationType: 'grammar_cleanup',
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
      preview: 'The main thing we shipped this quarter…',
    },
  ],
}

export const messyTranscript: V2Fixture = {
  name: 'messy-transcript',
  blocks,
  article,
}
