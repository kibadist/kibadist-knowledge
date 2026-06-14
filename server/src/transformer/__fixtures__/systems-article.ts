import type { ClaimExtractionLlm, LearningConceptCandidate } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'

/**
 * Shared systems-theory fixture for the claim-extraction (DET-352) and
 * learning-prompt (DET-353) golden specs — a short systems-theory explainer.
 *
 * The source blocks cover the SYSTEM DEFINITION, the ENVIRONMENT/BOUNDARY
 * distinction, the OPEN/CLOSED/ISOLATED classification, and the
 * SYSTEM-AS-TRANSFORMATION claim, so both lanes can extract grounded artifacts for
 * each. `blocks` are the classified source; `article` reshapes them (so claim/
 * concept → section mapping is exercised). `claimLlm` is the recorded claim-
 * extractor reply (DET-352); `conceptCandidates` + `llmResponse` are the recorded
 * learning-prompt artifacts (DET-353). All are fed in deterministically — NO live
 * LLM — mirroring how the learning-layer spec records its model reply.
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

const conceptCandidates: LearningConceptCandidate[] = [
  {
    id: 'c-system',
    sectionId: 's1',
    label: 'System',
    definition: 'A set of interacting parts forming a unified whole.',
    sourceBlockIds: ['b2'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-boundary',
    sectionId: 's1',
    label: 'Boundary and environment',
    definition: 'What separates a system from everything outside it.',
    sourceBlockIds: ['b3'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-types',
    sectionId: 's2',
    label: 'Open, closed, and isolated systems',
    definition: 'The classification of systems by what crosses their boundary.',
    sourceBlockIds: ['b4'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-transform',
    sectionId: 's2',
    label: 'Transformation process',
    definition: 'How a system converts inputs into outputs.',
    sourceBlockIds: ['b5'],
    aiAssisted: true,
    validationStatus: 'pending',
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
  sourceExamples: [
    {
      text: 'A thermostat-controlled room: heat (energy) crosses the boundary, so it is not isolated.',
      sourceBlockIds: ['b4'],
    },
  ],
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
const claimLlm: ClaimExtractionLlm = {
  claims: [
    {
      text: 'A system is a set of interacting or interdependent components that form an integrated whole.',
      sourceBlockIds: ['b2'],
      claimType: 'definition',
      confidence: 0.95,
    },
    {
      text: 'A system is separated from its environment by a boundary; the environment is everything outside the system.',
      sourceBlockIds: ['b3'],
      claimType: 'distinction',
      confidence: 0.9,
    },
    {
      text: 'Systems are classified as open, closed, or isolated by what they exchange with their environment.',
      sourceBlockIds: ['b4'],
      claimType: 'classification',
      confidence: 0.92,
    },
    {
      text: 'A system can be viewed as a transformation that converts inputs into outputs.',
      sourceBlockIds: ['b5'],
      claimType: 'mechanism',
      confidence: 0.85,
    },
  ],
}

/** Recorded model output for this fixture (DET-353 — no live LLM). */
const llmResponse = {
  retrievalPrompts: [
    {
      question:
        'What is a system, in terms of its parts and what they form together?',
      expectedAnswerSourceBlockIds: ['b2'],
      relatedConceptCandidateIds: ['c-system'],
      promptType: 'definition',
      difficulty: 'easy',
    },
    {
      question:
        "What does a system's boundary separate it from, and what is its environment?",
      expectedAnswerSourceBlockIds: ['b3'],
      relatedConceptCandidateIds: ['c-boundary'],
      promptType: 'definition',
      difficulty: 'easy',
    },
    {
      question:
        'How do open, closed, and isolated systems differ in what crosses their boundary?',
      expectedAnswerSourceBlockIds: ['b4'],
      relatedConceptCandidateIds: ['c-types'],
      promptType: 'distinction',
      difficulty: 'medium',
    },
    {
      question:
        "What do a system's transformation processes do to its inputs and outputs?",
      expectedAnswerSourceBlockIds: ['b5'],
      relatedConceptCandidateIds: ['c-transform'],
      promptType: 'mechanism',
      difficulty: 'medium',
    },
  ],
  misconceptions: [
    {
      misconception: 'A closed system exchanges nothing with its environment.',
      correction:
        'A closed system still exchanges energy (just not matter); an isolated system is the one that exchanges neither.',
      sourceBlockIds: ['b4'],
      relatedConceptCandidateIds: ['c-types'],
      confidence: 0.85,
    },
    {
      misconception: "A system's boundary must be a physical wall.",
      correction:
        'A boundary is whatever separates the system from its environment; it can be conceptual rather than physical.',
      sourceBlockIds: ['b3'],
      relatedConceptCandidateIds: ['c-boundary'],
      confidence: 0.6,
    },
  ],
}

export const systemsArticle = {
  name: 'systems-article',
  blocks,
  article,
  conceptCandidates,
  llmResponse,
  claimLlm,
}
