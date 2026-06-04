import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'
import type { V2Fixture } from './index'

/**
 * Fixture 4 — academic-abstract. A paper abstract with title, subtitle and a
 * dense single section. Exercises: subtitle provenance, multi-paragraph
 * abstract, a key term, a cleanedOriginal heading.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'An empirical study of routing stability in trillion-parameter models',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'We study how expert routing degrades as sparse mixture-of-experts models scale past one trillion parameters.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Our experiments show that load-balancing loss must be annealed to keep routing stable at scale.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Sparse Mixtures of Experts at Scale', source: 'original' },
  subtitle: {
    text: 'An empirical study of routing stability in trillion-parameter models',
    source: 'original',
    sourceBlockIds: ['b2'],
  },
  abstract: [
    {
      id: 'a1',
      text: 'We study how expert routing degrades as sparse mixture-of-experts models scale past one trillion parameters.',
      sourceBlockIds: ['b3'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
    {
      id: 'a2',
      text: 'Experiments show load-balancing loss must be annealed to keep routing stable at scale.',
      sourceBlockIds: ['b4'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Findings',
      headingSource: 'cleanedOriginal',
      sourceBlockIds: ['b3', 'b4'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Routing degrades predictably as the model scales past one trillion parameters.',
          sourceBlockIds: ['b3'],
          transformationType: 'light_reword',
          fidelityRisk: 'medium',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Annealing the load-balancing loss restores routing stability at scale.',
          sourceBlockIds: ['b4'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [{ term: 'Mixture of experts', sourceBlockIds: ['b3'] }],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    {
      blockId: 'b3',
      blockType: 'PARAGRAPH',
      preview: 'We study how expert routing degrades…',
    },
  ],
}

export const academicAbstract: V2Fixture = {
  name: 'academic-abstract',
  blocks,
  article,
}
