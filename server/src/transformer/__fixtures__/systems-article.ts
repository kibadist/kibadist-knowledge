import type { LearningConceptCandidate } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'

/**
 * Learning-prompt fixture (DET-353) — an article on systems theory. Source blocks
 * cover the definition of a system, its boundary/environment, the open/closed/
 * isolated classification, and transformation processes, so the learning-prompt
 * stage can generate grounded recall prompts for each. The `llmResponse` is the
 * RECORDED model output (no live LLM).
 */

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A system is a set of interacting or interdependent parts that together form a unified whole with a purpose.',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'The boundary of a system separates it from its environment — everything outside the system that can affect it or be affected by it.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'Systems are classified by what crosses their boundary: an open system exchanges both matter and energy with its environment, a closed system exchanges energy but not matter, and an isolated system exchanges neither.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'A system carries out transformation processes that convert inputs into outputs, changing the state of whatever passes through it.',
    removable: false,
  },
]

const conceptCandidates: LearningConceptCandidate[] = [
  {
    id: 'c-system',
    sectionId: 's1',
    label: 'System',
    definition: 'A set of interacting parts forming a unified whole.',
    sourceBlockIds: ['b1'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-boundary',
    sectionId: 's1',
    label: 'Boundary and environment',
    definition: 'What separates a system from everything outside it.',
    sourceBlockIds: ['b2'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-types',
    sectionId: 's2',
    label: 'Open, closed, and isolated systems',
    definition: 'The classification of systems by what crosses their boundary.',
    sourceBlockIds: ['b3'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-transform',
    sectionId: 's2',
    label: 'Transformation process',
    definition: 'How a system converts inputs into outputs.',
    sourceBlockIds: ['b4'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'explainer',
  title: { text: 'What is a system?', source: 'original' },
  abstract: [
    {
      id: 'a1',
      text: 'A system is interacting parts within a boundary; what crosses that boundary classifies it, and transformation processes drive what it does.',
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
      transformationType: 'light_reword',
      fidelityRisk: 'medium',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Systems and boundaries',
      headingSource: 'inferred',
      sourceBlockIds: ['b1', 'b2'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'A system is a set of interacting parts that form a unified whole with a purpose.',
          sourceBlockIds: ['b1'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Its boundary separates the system from its environment — what lies outside it.',
          sourceBlockIds: ['b2'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: 'Kinds of system',
      headingSource: 'inferred',
      sourceBlockIds: ['b3', 'b4'],
      blocks: [
        {
          id: 'p3',
          type: 'list',
          ordered: false,
          items: [
            'Open: exchanges matter and energy.',
            'Closed: exchanges energy but not matter.',
            'Isolated: exchanges neither.',
          ],
          sourceBlockIds: ['b3'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
        {
          id: 'p4',
          type: 'paragraph',
          text: 'Whatever its type, a system runs transformation processes that turn inputs into outputs.',
          sourceBlockIds: ['b4'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [
    {
      text: 'A thermostat-controlled room: heat (energy) crosses the boundary, so it is not isolated.',
      sourceBlockIds: ['b3'],
    },
  ],
  caveats: [],
  originalStructure: [],
}

/** Recorded model output for this fixture (DET-353 — no live LLM). */
const llmResponse = {
  retrievalPrompts: [
    {
      question:
        'What is a system, in terms of its parts and what they form together?',
      expectedAnswerSourceBlockIds: ['b1'],
      relatedConceptCandidateIds: ['c-system'],
      promptType: 'definition',
      difficulty: 'easy',
    },
    {
      question:
        "What does a system's boundary separate it from, and what is its environment?",
      expectedAnswerSourceBlockIds: ['b2'],
      relatedConceptCandidateIds: ['c-boundary'],
      promptType: 'definition',
      difficulty: 'easy',
    },
    {
      question:
        'How do open, closed, and isolated systems differ in what crosses their boundary?',
      expectedAnswerSourceBlockIds: ['b3'],
      relatedConceptCandidateIds: ['c-types'],
      promptType: 'distinction',
      difficulty: 'medium',
    },
    {
      question: "What do a system's transformation processes do to its inputs?",
      expectedAnswerSourceBlockIds: ['b4'],
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
      sourceBlockIds: ['b3'],
      relatedConceptCandidateIds: ['c-types'],
      confidence: 0.85,
    },
    {
      misconception: "A system's boundary must be a physical wall.",
      correction:
        'A boundary is whatever separates the system from its environment; it can be conceptual rather than physical.',
      sourceBlockIds: ['b2'],
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
}
