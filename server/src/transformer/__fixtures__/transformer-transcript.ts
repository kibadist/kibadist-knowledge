import type { ClaimExtractionLlm, LearningConceptCandidate } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'

/**
 * Shared transformer-block fixture for the claim-extraction (DET-352) and
 * learning-prompt (DET-353) golden specs — a spoken transcript explaining a
 * Transformer block, with filler removed as noise.
 *
 * The source blocks cover ATTENTION, Q/K/V, the MLP EXPANSION/GATE/DOWN PROJECTION,
 * the NON-LINEARITY / activation function, and LAYER NORMALIZATION, so both lanes
 * can extract grounded artifacts for each. `blocks` are the classified source;
 * `article` reshapes them across three sections (so claim/concept → section mapping
 * is exercised). `claimLlm` is the recorded claim-extractor reply (DET-352);
 * `conceptCandidates` + `llmResponse` are the recorded learning-prompt artifacts
 * (DET-353). All are fed in deterministically — NO live LLM.
 */

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: "Okay, um, so, yeah, let's talk about the transformer block, right?",
    removable: true,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Attention lets each token look at every other token and decide how much to pull in from each of them.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'It does that with three projections — queries, keys, and values — where the query of one token is compared against the keys of all tokens to weight their values.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'After attention the MLP expands the hidden dimension with an up projection, applies a gate, and then a down projection brings the dimension back.',
    removable: false,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The non-linearity in the MLP is what lets the network model relationships that are not just linear combinations of the inputs.',
    removable: false,
  },
  {
    id: 'b6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Each sublayer is wrapped with layer normalization, which keeps the activations stable across depth.',
    removable: false,
  },
]

const conceptCandidates: LearningConceptCandidate[] = [
  {
    id: 'c-qkv',
    sectionId: 's1',
    label: 'Query, key, value',
    definition:
      'The three projections self-attention derives per token to weight the values.',
    sourceBlockIds: ['b3'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-mlp',
    sectionId: 's2',
    label: 'MLP (feed-forward block)',
    definition:
      'An up projection, a gate, and a down projection applied to each token.',
    sourceBlockIds: ['b4'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-act',
    sectionId: 's2',
    label: 'Non-linear activation',
    definition: 'The non-linearity in the MLP between its linear projections.',
    sourceBlockIds: ['b5'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
  {
    id: 'c-ln',
    sectionId: 's3',
    label: 'Layer normalization',
    definition: 'Rescales activations so they stay stable across depth.',
    sourceBlockIds: ['b6'],
    aiAssisted: true,
    validationStatus: 'pending',
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'explainer',
  title: { text: 'The transformer block', source: 'inferred' },
  abstract: [
    {
      id: 'a1',
      text: 'A transformer block combines attention with a multi-layer perceptron, wrapped in layer normalization.',
      sourceBlockIds: ['b2', 'b4', 'b6'],
      transformationType: 'light_reword',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Attention',
      headingSource: 'inferred',
      sourceBlockIds: ['b2', 'b3'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Attention lets each token look at every other token and decide how much to pull in from each of them.',
          sourceBlockIds: ['b2'],
          transformationType: 'grammar_cleanup',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'It does that with three projections — queries, keys, and values — where the query of one token is compared against the keys of all tokens to weight their values.',
          sourceBlockIds: ['b3'],
          transformationType: 'grammar_cleanup',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: 'The MLP',
      headingSource: 'inferred',
      sourceBlockIds: ['b4', 'b5'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'After attention the MLP expands the hidden dimension with an up projection, applies a gate, and then a down projection brings the dimension back.',
          sourceBlockIds: ['b4'],
          transformationType: 'grammar_cleanup',
          fidelityRisk: 'low',
        },
        {
          id: 'p4',
          type: 'paragraph',
          text: 'The non-linearity in the MLP is what lets the network model relationships that are not just linear combinations of the inputs.',
          sourceBlockIds: ['b5'],
          transformationType: 'grammar_cleanup',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's3',
      heading: 'Layer normalization',
      headingSource: 'inferred',
      sourceBlockIds: ['b6'],
      blocks: [
        {
          id: 'p5',
          type: 'paragraph',
          text: 'Each sublayer is wrapped with layer normalization, which keeps the activations stable across depth.',
          sourceBlockIds: ['b6'],
          transformationType: 'grammar_cleanup',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [
    { term: 'Attention', sourceBlockIds: ['b2'] },
    { term: 'Layer normalization', sourceBlockIds: ['b6'] },
  ],
  sourceExamples: [],
  caveats: [],
  originalStructure: [
    {
      blockId: 'b2',
      blockType: 'PARAGRAPH',
      preview: 'Attention lets each token look at every other token…',
    },
  ],
}

/**
 * The recorded claim-extractor LLM reply for this fixture (DET-352). The service
 * grounds these against `blocks`, derives `articleSectionIds` from `article`, and
 * mints ids — so the spec asserts the required claims survive with correct
 * provenance (attention, Q/K/V, the MLP projections, the non-linearity, layer norm).
 */
const claimLlm: ClaimExtractionLlm = {
  claims: [
    {
      text: 'Attention lets each token attend to every other token and decide how much to pull in from each.',
      sourceBlockIds: ['b2'],
      claimType: 'mechanism',
      confidence: 0.9,
    },
    {
      text: 'Attention uses three projections — queries, keys, and values — comparing one token’s query against all tokens’ keys to weight their values.',
      sourceBlockIds: ['b3'],
      claimType: 'mechanism',
      confidence: 0.9,
    },
    {
      text: 'The MLP expands the hidden dimension with an up projection, applies a gate, then a down projection restores the dimension.',
      sourceBlockIds: ['b4'],
      claimType: 'mechanism',
      confidence: 0.88,
    },
    {
      text: 'The non-linearity in the MLP lets the network model relationships that are not merely linear combinations.',
      sourceBlockIds: ['b5'],
      claimType: 'causal_claim',
      confidence: 0.82,
    },
    {
      text: 'Each sublayer is wrapped in layer normalization, which keeps activations stable across depth.',
      sourceBlockIds: ['b6'],
      claimType: 'mechanism',
      confidence: 0.87,
    },
  ],
}

/** Recorded model output for this fixture (DET-353 — no live LLM). */
const llmResponse = {
  retrievalPrompts: [
    {
      question:
        'What are the query, key, and value vectors in self-attention, and how do they combine?',
      expectedAnswerSourceBlockIds: ['b3'],
      relatedConceptCandidateIds: ['c-qkv'],
      promptType: 'mechanism',
      difficulty: 'medium',
    },
    {
      question:
        'What does the MLP (feed-forward block) do to each token after attention?',
      expectedAnswerSourceBlockIds: ['b4'],
      relatedConceptCandidateIds: ['c-mlp'],
      promptType: 'definition',
      difficulty: 'easy',
    },
    {
      question:
        'What does layer normalization do to the activations at each layer, and why?',
      expectedAnswerSourceBlockIds: ['b6'],
      relatedConceptCandidateIds: ['c-ln'],
      promptType: 'mechanism',
      difficulty: 'medium',
    },
    {
      question:
        'Why must the MLP apply a non-linear activation function such as GELU or ReLU between its linear layers?',
      expectedAnswerSourceBlockIds: ['b5'],
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
      sourceBlockIds: ['b5'],
      relatedConceptCandidateIds: ['c-act'],
      confidence: 0.85,
    },
    {
      misconception: 'Attention weights are learned once and stay fixed.',
      correction:
        'Attention weights are computed per input from query–key comparisons.',
      sourceBlockIds: ['b3'],
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
  claimLlm,
}
