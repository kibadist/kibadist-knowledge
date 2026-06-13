import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2 } from '../transformer.types'

/**
 * Claim-extraction fixture (DET-352) — a spoken transcript explaining a
 * transformer block, with filler removed as noise.
 *
 * The acceptance criteria require this fixture to extract claims about: ATTENTION,
 * Q/K/V, the MLP EXPANSION/GATE/DOWN PROJECTION, LAYER NORM, and the NON-LINEARITY.
 * `blocks` are the classified source; `article` reshapes them across three
 * sections; `claimLlm` is the recorded extractor-LLM reply the deterministic spec
 * feeds in (NO live LLM).
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

const claimLlm = {
  claims: [
    {
      text: 'Attention lets each token attend to every other token and decide how much to pull in from each.',
      sourceBlockIds: ['b2'],
      claimType: 'mechanism' as const,
      confidence: 0.9,
    },
    {
      text: 'Attention uses three projections — queries, keys, and values — comparing one token’s query against all tokens’ keys to weight their values.',
      sourceBlockIds: ['b3'],
      claimType: 'mechanism' as const,
      confidence: 0.9,
    },
    {
      text: 'The MLP expands the hidden dimension with an up projection, applies a gate, then a down projection restores the dimension.',
      sourceBlockIds: ['b4'],
      claimType: 'mechanism' as const,
      confidence: 0.88,
    },
    {
      text: 'The non-linearity in the MLP lets the network model relationships that are not merely linear combinations.',
      sourceBlockIds: ['b5'],
      claimType: 'causal_claim' as const,
      confidence: 0.82,
    },
    {
      text: 'Each sublayer is wrapped in layer normalization, which keeps activations stable across depth.',
      sourceBlockIds: ['b6'],
      claimType: 'mechanism' as const,
      confidence: 0.87,
    },
  ],
}

export const transformerTranscript = {
  name: 'transformer-transcript',
  blocks,
  article,
  claimLlm,
}
