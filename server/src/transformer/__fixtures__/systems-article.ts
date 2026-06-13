import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'

/**
 * Claim-extraction fixture (DET-352) — a short systems-theory explainer.
 *
 * The acceptance criteria require this fixture to extract: the SYSTEM DEFINITION,
 * the ENVIRONMENT/BOUNDARY distinction, the OPEN/CLOSED/ISOLATED classification,
 * and the SYSTEM-AS-TRANSFORMATION claim. `blocks` are the classified source;
 * `article` reshapes them (so claim → section mapping is exercised); `claimLlm`
 * is the recorded extractor-LLM reply the deterministic spec feeds in (NO live
 * LLM), mirroring how the learning-layer spec records its model reply.
 */

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Systems',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A system is a set of interacting or interdependent components that form an integrated whole.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Everything outside the system is its environment; the boundary is what separates the system from its environment.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Systems are classified as open (exchanging both matter and energy with their environment), closed (exchanging energy but not matter), or isolated (exchanging neither).',
    removable: false,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A system can be viewed as a transformation that converts inputs into outputs.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'explainer',
  title: { text: 'Systems', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'A system is a set of interacting components forming an integrated whole.',
      sourceBlockIds: ['b2'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Definition and boundary',
      headingSource: 'inferred',
      sectionRole: 'definition',
      sourceBlockIds: ['b1', 'b2', 'b3'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'A system is a set of interacting or interdependent components that form an integrated whole.',
          sourceBlockIds: ['b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Everything outside the system is its environment; the boundary is what separates the system from its environment.',
          sourceBlockIds: ['b3'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: 'Classification and behaviour',
      headingSource: 'inferred',
      sectionRole: 'claim',
      sourceBlockIds: ['b4', 'b5'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Systems are classified as open (exchanging both matter and energy with their environment), closed (exchanging energy but not matter), or isolated (exchanging neither).',
          sourceBlockIds: ['b4'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 'p4',
          type: 'paragraph',
          text: 'A system can be viewed as a transformation that converts inputs into outputs.',
          sourceBlockIds: ['b5'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [{ term: 'System', sourceBlockIds: ['b2'] }],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    { blockId: 'b1', blockType: 'HEADING', preview: 'Systems' },
    {
      blockId: 'b2',
      blockType: 'PARAGRAPH',
      preview: 'A system is a set of interacting or interdependent components…',
    },
  ],
}

/**
 * The recorded claim-extractor LLM reply for this fixture (DET-352). The service
 * grounds these against `blocks`, derives `articleSectionIds` from `article`, and
 * mints ids — so the spec asserts the four required claims survive with correct
 * provenance. `sectionRole` is NOT in the reply (code owns structure).
 */
const claimLlm = {
  claims: [
    {
      text: 'A system is a set of interacting or interdependent components that form an integrated whole.',
      sourceBlockIds: ['b2'],
      claimType: 'definition' as const,
      confidence: 0.95,
    },
    {
      text: 'A system is separated from its environment by a boundary; the environment is everything outside the system.',
      sourceBlockIds: ['b3'],
      claimType: 'distinction' as const,
      confidence: 0.9,
    },
    {
      text: 'Systems are classified as open, closed, or isolated by what they exchange with their environment.',
      sourceBlockIds: ['b4'],
      claimType: 'classification' as const,
      confidence: 0.92,
    },
    {
      text: 'A system can be viewed as a transformation that converts inputs into outputs.',
      sourceBlockIds: ['b5'],
      claimType: 'mechanism' as const,
      confidence: 0.85,
    },
  ],
}

export const systemsArticle = {
  name: 'systems-article',
  blocks,
  article,
  claimLlm,
}
