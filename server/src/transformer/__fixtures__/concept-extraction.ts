/**
 * DET-351 concept-extraction fixtures. Each pairs a concept-rich source (the two
 * the ticket calls out — a transformer-architecture transcript and a systems
 * article) with a hand-authored valid `ArticleJsonV2` and a RECORDED LLM
 * extraction (`llmResponse`, the wire shape the model returns). The spec feeds the
 * recorded response through `LearningLayerService.extractArticleConcepts` and
 * asserts the CODE guards (grounding, normalize+dedup, section-id resolution,
 * eligibility, no auto-promotion) preserve the acceptance-criteria counts — ≥8 for
 * the transformer transcript, ≥10 for the systems article — with NO live LLM.
 *
 * Each recorded response deliberately includes a duplicate (varied casing /
 * punctuation) and an ungrounded entry so the dedup and grounding guards are
 * exercised, and the asserted count is what survives them.
 */

import type { ArticleConceptExtractionLlm } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'
import type { ArticleJsonV2, ArticleParagraph } from '../transformer.types'

export interface ConceptExtractionFixture {
  name: string
  blocks: ClassifiedBlockInput[]
  article: ArticleJsonV2
  llmResponse: ArticleConceptExtractionLlm
}

const para = (
  id: string,
  text: string,
  sourceBlockIds: string[],
): Extract<
  ArticleJsonV2['sections'][number]['blocks'][number],
  { type: 'paragraph' }
> => ({
  id,
  type: 'paragraph',
  text,
  sourceBlockIds,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
})

/** An abstract paragraph (no `type` discriminator). */
const absPara = (
  id: string,
  text: string,
  sourceBlockIds: string[],
): ArticleParagraph => ({
  id,
  text,
  sourceBlockIds,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
})

// --- Fixture 1: transformer-architecture transcript ------------------------

const transformerBlocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'Okay, um, can everyone hear me? Great, let me share my screen.',
    removable: true,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A transformer is a neural-network architecture built entirely around attention, dispensing with recurrence.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Self-attention lets every token attend to every other token in the sequence to build context-aware representations.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Attention is computed from three learned projections of each token: a query, a key, and a value.',
    removable: false,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The query of one token is compared against the keys of all tokens to produce attention scores.',
    removable: false,
  },
  {
    id: 'b6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Those scores pass through a softmax so they form a distribution that weights the values into the output.',
    removable: false,
  },
  {
    id: 'b7',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Multi-head attention runs several attention operations in parallel, each in its own subspace, then concatenates them.',
    removable: false,
  },
  {
    id: 'b8',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'After attention, each position is processed independently by a position-wise MLP (a feed-forward network).',
    removable: false,
  },
  {
    id: 'b9',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Because attention is order-agnostic, positional encodings are added to the inputs to inject sequence order.',
    removable: false,
  },
  {
    id: 'b10',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Residual connections and layer normalization wrap each sublayer to keep training stable.',
    removable: false,
  },
  {
    id: 'b11',
    type: 'PARAGRAPH',
    classification: 'CAVEAT',
    text: 'People often confuse self-attention with recurrence, but attention carries no hidden state across steps.',
    removable: false,
  },
]

const transformerArticle: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'explainer',
  title: { text: 'How a transformer works', source: 'inferred' },
  abstract: [
    absPara(
      'a1',
      'A transformer is an attention-based architecture; this walks through its pieces.',
      ['b2'],
    ),
  ],
  sections: [
    {
      id: 's1',
      heading: 'What a transformer is',
      headingSource: 'inferred',
      sourceBlockIds: ['b2'],
      blocks: [
        para(
          'p1',
          'A transformer is a neural-network architecture built entirely around attention.',
          ['b2'],
        ),
      ],
    },
    {
      id: 's2',
      heading: 'Self-attention and Q/K/V',
      headingSource: 'inferred',
      sourceBlockIds: ['b3', 'b4', 'b5', 'b6'],
      blocks: [
        para(
          'p2',
          'Self-attention lets every token attend to every other token.',
          ['b3'],
        ),
        para('p3', 'Each token has a query, a key, and a value.', ['b4']),
        para('p4', 'A query is compared against keys to score relevance.', [
          'b5',
        ]),
        para('p5', 'A softmax turns the scores into weights over the values.', [
          'b6',
        ]),
      ],
    },
    {
      id: 's3',
      heading: 'Heads and the feed-forward network',
      headingSource: 'inferred',
      sourceBlockIds: ['b7', 'b8'],
      blocks: [
        para(
          'p6',
          'Multi-head attention runs attention in parallel subspaces.',
          ['b7'],
        ),
        para('p7', 'A position-wise MLP processes each position afterwards.', [
          'b8',
        ]),
      ],
    },
    {
      id: 's4',
      heading: 'Order and stability',
      headingSource: 'inferred',
      sourceBlockIds: ['b9', 'b10'],
      blocks: [
        para('p8', 'Positional encodings inject sequence order.', ['b9']),
        para(
          'p9',
          'Residual connections and layer normalization stabilize training.',
          ['b10'],
        ),
      ],
    },
    {
      id: 's5',
      heading: 'A common confusion',
      headingSource: 'inferred',
      sourceBlockIds: ['b11'],
      blocks: [
        para(
          'p10',
          'Self-attention is not recurrence — it carries no hidden state.',
          ['b11'],
        ),
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

const transformerLlmResponse: ArticleConceptExtractionLlm = {
  candidates: [
    {
      name: 'Transformer',
      type: 'core_concept',
      shortDefinition:
        'A neural-network architecture built entirely around attention.',
      domain: 'Machine learning',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['b2'],
      relationships: [
        { type: 'related_to', targetName: 'Self-attention' },
        { type: 'applied_in', targetName: 'Multi-head attention' },
      ],
    },
    {
      name: 'Self-attention',
      type: 'core_concept',
      shortDefinition:
        'Each token attends to every other token to build context.',
      domain: 'Machine learning',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['b3'],
      relationships: [
        { type: 'prerequisite_of', targetName: 'Multi-head attention' },
      ],
    },
    {
      name: 'Attention',
      type: 'core_concept',
      shortDefinition:
        'Computed from a query, key, and value projection of each token.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['b4'],
      relationships: [],
    },
    {
      name: 'Query',
      type: 'term',
      shortDefinition:
        'The projection compared against keys to score relevance.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b4', 'b5'],
      relationships: [{ type: 'related_to', targetName: 'Key' }],
    },
    {
      name: 'Key',
      type: 'term',
      shortDefinition: 'The projection a query is compared against.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b4', 'b5'],
      relationships: [{ type: 'related_to', targetName: 'Value' }],
    },
    {
      name: 'Value',
      type: 'term',
      shortDefinition: 'The projection weighted by the attention distribution.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b4', 'b6'],
      relationships: [],
    },
    {
      name: 'Softmax',
      type: 'process',
      shortDefinition:
        'Turns raw attention scores into a distribution over the values.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b6'],
      relationships: [],
    },
    {
      name: 'Multi-head attention',
      type: 'supporting_concept',
      shortDefinition:
        'Several attention operations run in parallel subspaces.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['b7'],
      relationships: [],
    },
    {
      name: 'Position-wise MLP',
      type: 'supporting_concept',
      shortDefinition:
        'A feed-forward network applied to each position after attention.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b8'],
      relationships: [],
    },
    {
      name: 'Positional encoding',
      type: 'supporting_concept',
      shortDefinition:
        'Added to inputs to inject sequence order into attention.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b9'],
      relationships: [],
    },
    {
      name: 'Residual connection',
      type: 'supporting_concept',
      shortDefinition: 'Wraps each sublayer to stabilize training.',
      importance: 'low',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b10'],
      relationships: [],
    },
    {
      name: 'Layer normalization',
      type: 'supporting_concept',
      shortDefinition: 'Normalizes each sublayer to keep training stable.',
      importance: 'low',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b10'],
      relationships: [],
    },
    {
      name: 'Self-attention is recurrence',
      type: 'misconception',
      shortDefinition:
        'A confusion: attention carries no hidden state across steps.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b11'],
      relationships: [
        { type: 'misconception_about', targetName: 'Self-attention' },
      ],
    },
    // Duplicate of "Self-attention" (varied casing/punctuation) — dedup collapses it.
    {
      name: 'Self Attention',
      type: 'core_concept',
      shortDefinition: 'Tokens attend to one another.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['b3'],
      relationships: [],
    },
    // Ungrounded (no real block id) — the grounding guard drops it.
    {
      name: 'Backpropagation',
      type: 'term',
      shortDefinition: 'Not actually taught by this source.',
      importance: 'low',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: [],
      relationships: [],
    },
  ],
}

export const transformerTranscriptFixture: ConceptExtractionFixture = {
  name: 'transformer-transcript',
  blocks: transformerBlocks,
  article: transformerArticle,
  llmResponse: transformerLlmResponse,
}

// --- Fixture 2: systems article --------------------------------------------

const systemsBlocks: ClassifiedBlockInput[] = [
  {
    id: 'c1',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'Subscribe and hit the bell before we get into it.',
    removable: true,
  },
  {
    id: 'c2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A system is a set of interrelated components that together form a whole and pursue a common purpose.',
    removable: false,
  },
  {
    id: 'c3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Every system has a boundary that separates it from its environment.',
    removable: false,
  },
  {
    id: 'c4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The environment is everything outside the boundary that the system interacts with.',
    removable: false,
  },
  {
    id: 'c5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'An open system exchanges matter, energy, or information with its environment.',
    removable: false,
  },
  {
    id: 'c6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A closed system exchanges energy but not matter with its environment.',
    removable: false,
  },
  {
    id: 'c7',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A subsystem is a system nested within a larger system, contributing to the whole.',
    removable: false,
  },
  {
    id: 'c8',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Inputs are what a system takes in from its environment; outputs are what it produces.',
    removable: false,
  },
  {
    id: 'c9',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Feedback occurs when a system feeds its output back as input to regulate its behavior.',
    removable: false,
  },
  {
    id: 'c10',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Negative feedback dampens change and keeps a system near equilibrium; positive feedback amplifies change.',
    removable: false,
  },
  {
    id: 'c11',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Emergence is the appearance of system-level properties that none of the parts have on their own.',
    removable: false,
  },
  {
    id: 'c12',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Homeostasis is a system’s tendency to maintain a stable internal state through feedback.',
    removable: false,
  },
]

const systemsArticle: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  shape: 'explainer',
  title: { text: 'Systems thinking basics', source: 'inferred' },
  abstract: [
    absPara('sa1', 'The core vocabulary of systems thinking, defined.', ['c2']),
  ],
  sections: [
    {
      id: 'ss1',
      heading: 'System, boundary, environment',
      headingSource: 'inferred',
      sourceBlockIds: ['c2', 'c3', 'c4'],
      blocks: [
        para('q1', 'A system is interrelated components forming a whole.', [
          'c2',
        ]),
        para('q2', 'A boundary separates a system from its environment.', [
          'c3',
        ]),
        para('q3', 'The environment is everything outside the boundary.', [
          'c4',
        ]),
      ],
    },
    {
      id: 'ss2',
      heading: 'Open, closed, and nested systems',
      headingSource: 'inferred',
      sourceBlockIds: ['c5', 'c6', 'c7'],
      blocks: [
        para('q4', 'An open system exchanges matter with its environment.', [
          'c5',
        ]),
        para('q5', 'A closed system exchanges energy but not matter.', ['c6']),
        para('q6', 'A subsystem is nested within a larger system.', ['c7']),
      ],
    },
    {
      id: 'ss3',
      heading: 'Inputs, outputs, feedback',
      headingSource: 'inferred',
      sourceBlockIds: ['c8', 'c9', 'c10'],
      blocks: [
        para('q7', 'Inputs come in; outputs go out.', ['c8']),
        para('q8', 'Feedback routes output back as input.', ['c9']),
        para(
          'q9',
          'Negative feedback stabilizes; positive feedback amplifies.',
          ['c10'],
        ),
      ],
    },
    {
      id: 'ss4',
      heading: 'Whole-system behavior',
      headingSource: 'inferred',
      sourceBlockIds: ['c11', 'c12'],
      blocks: [
        para('q10', 'Emergence is system-level properties the parts lack.', [
          'c11',
        ]),
        para('q11', 'Homeostasis maintains a stable internal state.', ['c12']),
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

const systemsLlmResponse: ArticleConceptExtractionLlm = {
  candidates: [
    {
      name: 'System',
      type: 'core_concept',
      shortDefinition: 'Interrelated components forming a purposeful whole.',
      domain: 'Systems theory',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c2'],
      relationships: [
        { type: 'related_to', targetName: 'Boundary' },
        { type: 'related_to', targetName: 'Subsystem' },
      ],
    },
    {
      name: 'Boundary',
      type: 'core_concept',
      shortDefinition: 'Separates a system from its environment.',
      domain: 'Systems theory',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c3'],
      relationships: [{ type: 'related_to', targetName: 'Environment' }],
    },
    {
      name: 'Environment',
      type: 'supporting_concept',
      shortDefinition:
        'Everything outside the boundary the system interacts with.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['c4'],
      relationships: [],
    },
    {
      name: 'Open system',
      type: 'core_concept',
      shortDefinition:
        'Exchanges matter, energy, or information with its environment.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c5'],
      relationships: [{ type: 'contrasts_with', targetName: 'Closed system' }],
    },
    {
      name: 'Closed system',
      type: 'distinction',
      shortDefinition: 'Exchanges energy but not matter with its environment.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c6'],
      relationships: [{ type: 'contrasts_with', targetName: 'Open system' }],
    },
    {
      name: 'Subsystem',
      type: 'core_concept',
      shortDefinition: 'A system nested within a larger system.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c7'],
      relationships: [{ type: 'example_of', targetName: 'System' }],
    },
    {
      name: 'Input',
      type: 'term',
      shortDefinition: 'What a system takes in from its environment.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['c8'],
      relationships: [],
    },
    {
      name: 'Output',
      type: 'term',
      shortDefinition: 'What a system produces.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['c8'],
      relationships: [{ type: 'related_to', targetName: 'Feedback' }],
    },
    {
      name: 'Feedback',
      type: 'process',
      shortDefinition: 'Output fed back as input to regulate behavior.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c9'],
      relationships: [{ type: 'prerequisite_of', targetName: 'Homeostasis' }],
    },
    {
      name: 'Negative feedback',
      type: 'distinction',
      shortDefinition: 'Dampens change and keeps the system near equilibrium.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['c10'],
      relationships: [
        { type: 'contrasts_with', targetName: 'Positive feedback' },
      ],
    },
    {
      name: 'Positive feedback',
      type: 'distinction',
      shortDefinition: 'Amplifies change in the system.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['c10'],
      relationships: [
        { type: 'contrasts_with', targetName: 'Negative feedback' },
      ],
    },
    {
      name: 'Equilibrium',
      type: 'term',
      shortDefinition:
        'The stable state negative feedback keeps a system near.',
      importance: 'low',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['c10'],
      relationships: [],
    },
    {
      name: 'Emergence',
      type: 'core_concept',
      shortDefinition: 'System-level properties no part has on its own.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c11'],
      relationships: [],
    },
    {
      name: 'Homeostasis',
      type: 'core_concept',
      shortDefinition: 'Maintaining a stable internal state through feedback.',
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      sourceBlockIds: ['c12'],
      relationships: [{ type: 'related_to', targetName: 'Feedback' }],
    },
    // Duplicate of "Open system" (varied punctuation) — dedup collapses it.
    {
      name: 'Open-system',
      type: 'core_concept',
      shortDefinition: 'A system that exchanges with its surroundings.',
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: ['c5'],
      relationships: [],
    },
    // Ungrounded — the grounding guard drops it.
    {
      name: 'Entropy',
      type: 'term',
      shortDefinition: 'Not taught by this source.',
      importance: 'low',
      suggestedCognitiveState: 'Seen',
      sourceBlockIds: [],
      relationships: [],
    },
  ],
}

export const systemsArticleFixture: ConceptExtractionFixture = {
  name: 'systems-article',
  blocks: systemsBlocks,
  article: systemsArticle,
  llmResponse: systemsLlmResponse,
}

export const conceptExtractionFixtures: ConceptExtractionFixture[] = [
  transformerTranscriptFixture,
  systemsArticleFixture,
]
