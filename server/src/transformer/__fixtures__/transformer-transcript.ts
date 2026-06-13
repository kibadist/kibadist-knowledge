import type { LearningConceptCandidate } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'

/**
 * Learning-prompt fixture (DET-353) — a transcript explaining the Transformer
 * architecture. Source blocks cover Q/K/V (self-attention), the MLP / feed-forward
 * block, layer normalization, and the non-linearity / activation functions, so the
 * learning-prompt stage can generate grounded recall prompts for each. The
 * `llmResponse` is the RECORDED model output (no live LLM); the golden spec feeds
 * it through the real service and asserts the grounded result.
 */

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b0',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'Okay, um, so today we are going to walk through the Transformer block.',
    removable: true,
  },
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'Self-attention computes three vectors for every token: a query, a key, and a value. Each query is compared against every key to produce attention weights, which then take a weighted sum of the values.',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'After attention, every position passes through an MLP — a small feed-forward network of two linear layers applied independently to each token.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'Layer normalization rescales the activations at each layer so their mean and variance stay stable, which keeps training well-conditioned.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'Between its two linear layers the MLP applies a non-linear activation function such as GELU or ReLU; without that non-linearity the two linear layers would collapse into a single linear map.',
    removable: false,
  },
]

const conceptCandidates: LearningConceptCandidate[] = [
  {
    id: 'c-qkv',
    sectionId: 's1',
    label: 'Query, key, value',
    definition:
      'The three vectors self-attention derives per token to weight the values.',
    sourceBlockIds: ['b1'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-mlp',
    sectionId: 's1',
    label: 'MLP (feed-forward block)',
    definition: 'A two-layer feed-forward network applied to each token.',
    sourceBlockIds: ['b2'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-ln',
    sectionId: 's1',
    label: 'Layer normalization',
    definition: 'Rescales activations so their mean and variance stay stable.',
    sourceBlockIds: ['b3'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-act',
    sectionId: 's1',
    label: 'Non-linear activation',
    definition: 'The non-linearity (GELU/ReLU) between the MLP linear layers.',
    sourceBlockIds: ['b4'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'explainer',
  title: { text: 'Inside a Transformer block', source: 'inferred' },
  abstract: [
    {
      id: 'a1',
      text: 'A Transformer block runs self-attention, then a per-token MLP, with layer normalization and a non-linear activation holding it together.',
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
      transformationType: 'light_reword',
      fidelityRisk: 'medium',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'The Transformer block',
      headingSource: 'inferred',
      sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Self-attention computes a query, a key, and a value for every token; queries score against keys to weight the values.',
          sourceBlockIds: ['b1'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Each position then passes through an MLP, a two-layer feed-forward network applied independently per token.',
          sourceBlockIds: ['b2'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
        {
          id: 'co1',
          type: 'callout',
          title: 'Why the non-linearity matters',
          text: 'Without the activation function the two linear layers collapse into one linear map.',
          sourceBlockIds: ['b4'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

/** Recorded model output for this fixture (DET-353 — no live LLM). */
const llmResponse = {
  retrievalPrompts: [
    {
      question:
        'What are the query, key, and value vectors in self-attention, and how do they combine?',
      expectedAnswerSourceBlockIds: ['b1'],
      relatedConceptCandidateIds: ['c-qkv'],
      promptType: 'mechanism',
      difficulty: 'medium',
    },
    {
      question:
        'What does the MLP (feed-forward block) do to each token after attention?',
      expectedAnswerSourceBlockIds: ['b2'],
      relatedConceptCandidateIds: ['c-mlp'],
      promptType: 'definition',
      difficulty: 'easy',
    },
    {
      question:
        'What does layer normalization do to the activations at each layer, and why?',
      expectedAnswerSourceBlockIds: ['b3'],
      relatedConceptCandidateIds: ['c-ln'],
      promptType: 'mechanism',
      difficulty: 'medium',
    },
    {
      question:
        'Why must the MLP apply a non-linear activation function such as GELU or ReLU between its linear layers?',
      expectedAnswerSourceBlockIds: ['b4'],
      relatedConceptCandidateIds: ['c-act'],
      promptType: 'misconception_repair',
      difficulty: 'hard',
    },
  ],
  misconceptions: [
    {
      misconception:
        'Stacking two linear layers without an activation still adds expressive power.',
      correction:
        'Without a non-linearity the two linear layers collapse into a single linear map.',
      sourceBlockIds: ['b4'],
      relatedConceptCandidateIds: ['c-act'],
      confidence: 0.85,
    },
    {
      misconception: 'Attention weights are learned once and stay fixed.',
      correction:
        'Attention weights are computed per input from query–key comparisons.',
      sourceBlockIds: ['b1'],
      relatedConceptCandidateIds: ['c-qkv'],
      confidence: 0.7,
    },
  ],
}

export const transformerTranscript = {
  name: 'transformer-transcript',
  blocks,
  article,
  conceptCandidates,
  llmResponse,
}
