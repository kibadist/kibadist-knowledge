'use client'

import { useState } from 'react'

import '../(app)/transformer/transformer.css'

import { LearningToolsPanel } from '@/components/transformer/learning-tools-panel'
import {
  type InspectorSelection,
  SourceInspectorPanel,
} from '@/components/transformer/source-inspector-panel'
import type {
  ArticleSectionV2,
  LearningLayer,
  TransformerBlockView,
} from '@/lib/api'

/**
 * Visual + behavioural harness for the DET-353 learning-prompt surface.
 *
 * This is a PUBLIC route (outside the authenticated `(app)` group, like
 * `/magazine-demo`) so the retrieval-prompt + misconception UI can be eyeballed
 * and clicked in a browser WITHOUT a login, a backend, or an `OPENAI_API_KEY`.
 * It mounts the SAME `<LearningToolsPanel>` the real transformer article page
 * uses, fed a fixture `LearningLayer` whose `retrievalPromptCandidates` and
 * `misconceptions` mirror what `LearningPromptsService` produces from the
 * transformer-transcript source (Q/K/V, MLP, layer norm, the non-linearity, and
 * activation functions). Clicking an "expected answer" / "source refs" button
 * opens the same source inspector a real article uses, resolving the fixture
 * blocks below — so the source-grounding link is observable end to end.
 *
 * Real articles render the identical component with data from
 * `getTransformedArticle`; the generation logic itself is covered by the server
 * golden suite (`learning-prompts.golden.spec.ts`).
 */

// The grounding universe: the source blocks the prompts/misconceptions cite.
// Shaped like the real `TransformerBlockView` so the inspector renders them.
function block(
  id: string,
  orderIndex: number,
  text: string,
): TransformerBlockView {
  return {
    id,
    orderIndex,
    blockType: 'paragraph',
    text,
    pageNumber: null,
    charStart: null,
    charEnd: null,
    classification: 'CONCEPT',
    classificationStatus: 'classified',
    removable: false,
    noiseReason: null,
  }
}

const BLOCKS: TransformerBlockView[] = [
  block(
    'blk-qkv',
    0,
    'Self-attention projects each token into three vectors: a query, a key, and a value. The query of one token is compared against the keys of every token to score relevance; those scores then weight the values that are summed into the token’s new representation.',
  ),
  block(
    'blk-mlp',
    1,
    'After attention, each position passes independently through a position-wise MLP (a feed-forward network): a linear expansion, a non-linearity, and a linear projection back to the model width. This is where most of a transformer’s parameters live.',
  ),
  block(
    'blk-layernorm',
    2,
    'Layer normalization re-centres and re-scales the activations of each token across the feature dimension before the sub-layers. It keeps the scale of the residual stream stable so very deep stacks remain trainable.',
  ),
  block(
    'blk-nonlinear',
    3,
    'Without a non-linearity the stacked linear layers would collapse into a single linear map, so the network could not represent anything a one-layer model cannot. The activation function inside the MLP — historically ReLU, now often GELU — is what gives the model its expressive power.',
  ),
  block(
    'blk-residual',
    4,
    'A residual connection adds each sub-layer’s input back to its output. Gradients flow through the addition unchanged, which is what lets gradient descent train networks dozens of layers deep.',
  ),
]

const LAYER: LearningLayer = {
  concepts: [],
  retrievalPrompts: [],
  retrievalPromptCandidates: [
    {
      id: 'rp-qkv',
      question:
        'In self-attention, what are the query, key, and value vectors, and how do they combine to produce a token’s new representation?',
      expectedAnswerSourceBlockIds: ['blk-qkv'],
      relatedConceptCandidateIds: [],
      promptType: 'mechanism',
      difficulty: 'medium',
      status: 'ai_suggested',
    },
    {
      id: 'rp-mlp',
      question:
        'What does the position-wise MLP (feed-forward block) do to each position after attention, and why does most of a transformer’s parameter count live there?',
      expectedAnswerSourceBlockIds: ['blk-mlp'],
      relatedConceptCandidateIds: [],
      promptType: 'mechanism',
      difficulty: 'medium',
      status: 'ai_suggested',
    },
    {
      id: 'rp-layernorm',
      question:
        'What does layer normalization compute, and why does keeping the scale of the residual stream stable matter for very deep stacks?',
      expectedAnswerSourceBlockIds: ['blk-layernorm'],
      relatedConceptCandidateIds: [],
      promptType: 'definition',
      difficulty: 'medium',
      status: 'ai_suggested',
    },
    {
      id: 'rp-nonlinear',
      question:
        'Why is a non-linearity essential between the linear layers of the MLP — what would happen to the network’s expressive power without one?',
      expectedAnswerSourceBlockIds: ['blk-nonlinear'],
      relatedConceptCandidateIds: [],
      promptType: 'transfer',
      difficulty: 'hard',
      status: 'ai_suggested',
    },
    {
      id: 'rp-activation',
      question:
        'Which activation functions are used inside the transformer MLP, and what role does the activation function play in the block?',
      expectedAnswerSourceBlockIds: ['blk-nonlinear', 'blk-mlp'],
      relatedConceptCandidateIds: [],
      promptType: 'definition',
      difficulty: 'easy',
      status: 'ai_suggested',
    },
  ],
  misconceptions: [
    {
      id: 'mc-residual',
      misconception:
        'Residual connections are just a regularization trick that has little effect on training.',
      correction:
        'They add a sub-layer’s input back to its output so gradients flow through the addition unchanged — that gradient path is what makes training dozens of layers deep feasible, not a regularizer.',
      sourceBlockIds: ['blk-residual'],
      relatedConceptCandidateIds: [],
      confidence: 0.82,
      status: 'ai_suggested',
    },
    {
      id: 'mc-attention-rnn',
      misconception:
        'Self-attention processes tokens one after another in sequence, like an RNN.',
      correction:
        'Attention compares every token against every other token in parallel; there is no inherent left-to-right recurrence (order is supplied separately by positional information).',
      // Intentionally ungrounded — demonstrates the "general — not from your
      // source" labelling for an AI-suggested misconception with no block.
      sourceBlockIds: [],
      relatedConceptCandidateIds: [],
      confidence: 0.6,
      status: 'ai_suggested',
    },
  ],
}

const SECTIONS: ArticleSectionV2[] = []

export default function LearningToolsDemoPage() {
  const [selection, setSelection] = useState<InspectorSelection | null>(null)

  const blocksById = new Map(BLOCKS.map((b) => [b.id, b]))

  return (
    <div className='kbapp'>
      <main className='page' style={{ maxWidth: 880, margin: '0 auto' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono), monospace',
            fontSize: 11,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            margin: '0 0 8px',
          }}
        >
          ✦ Visual harness · fixture data · /learning-tools-demo · DET-353
        </p>
        <LearningToolsPanel
          articleId='demo-article'
          layer={LAYER}
          sections={SECTIONS}
          onInspect={setSelection}
        />
      </main>
      <SourceInspectorPanel
        selection={selection}
        blocksById={blocksById}
        sourceUrl={null}
        onClose={() => setSelection(null)}
      />
    </div>
  )
}
