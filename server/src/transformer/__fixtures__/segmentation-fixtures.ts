/**
 * Conceptual-segmentation fixtures (DET-347) — deterministic, NO live LLM.
 *
 * Each fixture is a hand-authored triple:
 *  - `blocks`: classified source blocks (`ClassifiedBlockInput`),
 *  - `structureModel`: a faithful inventory (only used to build the prompt — the
 *    segmentation service does not re-validate it), and
 *  - `llmResponse`: the EXACT segmentation a well-behaved model returns for those
 *    blocks (the `SegmentationLlm` wire shape, minus the code-minted ids).
 *
 * The spec feeds `llmResponse` through a stubbed `AiService` into the REAL
 * `ConceptualSegmentationService`, so it exercises the whole code path (prompt
 * build → completeJson parse → repair → source ordering → id minting → coverage
 * guard) without a network call. The two fixtures cover the acceptance bar:
 *  - a TRANSCRIPT of a transformer lecture (segment by teaching intent), and
 *  - a STRUCTURED ARTICLE about systems (group subsections into learning concepts).
 *
 * `requiredTopics` are the lowercased substrings every fixture's segment titles
 * must collectively contain (the DET-347 acceptance criteria for each source).
 */

import type { SegmentationLlm, SourceStructureModel } from '../schemas'
import type { ClassifiedBlockInput } from '../structure-model.service'

export interface SegmentationFixture {
  name: string
  blocks: ClassifiedBlockInput[]
  structureModel: SourceStructureModel
  /** What a well-behaved model returns (no ids — the service mints `seg-N`). */
  llmResponse: SegmentationLlm
  /** Lowercased topic substrings the produced segment titles must cover. */
  requiredTopics: string[]
}

/** A minimal structure model — the segmenter only stringifies it into the prompt. */
function emptyModel(
  partial: Partial<SourceStructureModel> = {},
): SourceStructureModel {
  return {
    title: null,
    subtitle: null,
    claims: [],
    definitions: [],
    examples: [],
    caveats: [],
    terminology: [],
    originalOutline: [],
    noiseDecisions: [],
    uncertainBlockIds: [],
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// Fixture 1 — a transformer lecture transcript (segment by teaching intent).
// ---------------------------------------------------------------------------

const transformerBlocks: ClassifiedBlockInput[] = [
  {
    id: 't0',
    type: 'PARAGRAPH',
    classification: 'NAVIGATION_NOISE',
    text: "Okay, uh, welcome back everyone — can you all hear me at the back? Great, let's, let's get going.",
    removable: true,
  },
  {
    id: 't1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'So the first thing that happens is the embedding: every token gets mapped to a vector, and that vector is what the rest of the network actually works on.',
    removable: false,
  },
  {
    id: 't2',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'The whole model is really just a decoder stack — you take that embedding and push it up through a tall stack of identical decoder layers, and each layer refines the representation a little.',
    removable: false,
  },
  {
    id: 't3',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'Inside each layer the key piece is attention. Attention lets every position look back at all the earlier positions and pull in whatever information it needs from them.',
    removable: false,
  },
  {
    id: 't4',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'After attention comes the MLP — a small per-position feed-forward network that processes each token independently and does most of the actual computation.',
    removable: false,
  },
  {
    id: 't5',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'Wrapped around each of those sub-blocks is layer norm: we normalize the activations before the attention and before the MLP so the scale stays under control and training is stable.',
    removable: false,
  },
  {
    id: 't6',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'Now the reason the MLP matters is that it injects a non-linearity. Without a non-linearity the whole stack would collapse into one big linear map and the model could not represent anything interesting.',
    removable: false,
  },
  {
    id: 't7',
    type: 'PARAGRAPH',
    classification: 'EXAMPLE',
    text: 'That non-linearity comes from the activation function in the middle of the MLP — in practice something like a ReLU or a GELU, applied element-wise to the hidden units.',
    removable: false,
  },
]

const transformerTranscript: SegmentationFixture = {
  name: 'transformer-transcript',
  blocks: transformerBlocks,
  structureModel: emptyModel({
    definitions: [
      {
        term: 'embedding',
        definition: 'token → vector',
        sourceBlockIds: ['t1'],
      },
      {
        term: 'attention',
        definition: 'positions attend to earlier positions',
        sourceBlockIds: ['t3'],
      },
    ],
  }),
  // Deliberately listed slightly out of source order (t6's non-linearity segment
  // is placed before the layer-norm one) so the spec can prove the service
  // re-sorts segments back into source-reading order.
  llmResponse: {
    segments: [
      {
        title: 'Token embedding',
        role: 'definition',
        sourceBlockIds: ['t1'],
        importance: 'high',
        summary:
          'Each token is mapped to a vector the rest of the network operates on.',
        mustPreserveClaims: ['every token gets mapped to a vector'],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'The decoder stack',
        role: 'orientation',
        sourceBlockIds: ['t2'],
        importance: 'high',
        summary:
          'The model is a tall stack of identical decoder layers that each refine the representation.',
        mustPreserveClaims: ['the whole model is really just a decoder stack'],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'Attention',
        role: 'mechanism',
        sourceBlockIds: ['t3'],
        importance: 'high',
        summary:
          'Attention lets each position pull information from all earlier positions.',
        mustPreserveClaims: [
          'attention lets every position look back at all the earlier positions',
        ],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'The MLP',
        role: 'mechanism',
        sourceBlockIds: ['t4'],
        importance: 'high',
        summary:
          'A per-position feed-forward network that does most of the computation.',
        mustPreserveClaims: ['a small per-position feed-forward network'],
        suggestedArticlePlacement: 'main_body',
      },
      // Out of order on purpose (t6 before t5):
      {
        title: 'Why we need a non-linearity',
        role: 'mechanism',
        sourceBlockIds: ['t6'],
        importance: 'high',
        summary:
          'The MLP injects a non-linearity; without it the stack collapses to a linear map.',
        mustPreserveClaims: [
          'without a non-linearity the whole stack would collapse into one big linear map',
        ],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'Layer norm',
        role: 'mechanism',
        sourceBlockIds: ['t5'],
        importance: 'medium',
        summary:
          'Layer normalization keeps activation scale under control before each sub-block.',
        mustPreserveClaims: [
          'we normalize the activations before the attention and before the MLP',
        ],
        suggestedArticlePlacement: 'callout',
      },
      {
        title: 'Activation functions',
        role: 'example',
        sourceBlockIds: ['t7'],
        importance: 'medium',
        summary:
          'The non-linearity is a ReLU/GELU activation applied element-wise inside the MLP.',
        mustPreserveClaims: ['something like a ReLU or a GELU'],
        suggestedArticlePlacement: 'main_body',
      },
    ],
    unsegmentedBlocks: [{ blockId: 't0', reason: 'spoken filler / mic check' }],
  },
  requiredTopics: [
    'embedding',
    'decoder stack',
    'attention',
    'mlp',
    'layer norm',
    'non-linearity',
    'activation function',
  ],
}

// ---------------------------------------------------------------------------
// Fixture 2 — a structured "systems" article (group subsections into concepts).
// ---------------------------------------------------------------------------

const systemsBlocks: ClassifiedBlockInput[] = [
  {
    id: 's0',
    type: 'HEADING',
    classification: 'BACKGROUND',
    text: 'What is a system?',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 's1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A system is a set of interacting or interdependent components that together form an integrated whole with a purpose.',
    removable: false,
  },
  {
    id: 's2',
    type: 'HEADING',
    classification: 'BACKGROUND',
    text: 'Boundaries (and the environment around them)',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 's3',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'Every system has a boundary that separates it from its environment; everything outside the boundary that affects the system is its environment.',
    removable: false,
  },
  {
    id: 's4',
    type: 'HEADING',
    classification: 'BACKGROUND',
    text: 'natural vs. man-made',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 's5',
    type: 'PARAGRAPH',
    classification: 'EXAMPLE',
    text: 'Systems can be natural, such as an ecosystem or the solar system, or human-made, such as a car or a national economy.',
    removable: false,
  },
  {
    id: 's6',
    type: 'HEADING',
    classification: 'BACKGROUND',
    text: 'Open / closed / isolated',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 's7',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'By what crosses the boundary, systems are classified as open (exchange matter and energy), closed (exchange energy only), or isolated (exchange nothing).',
    removable: false,
  },
  {
    id: 's8',
    type: 'HEADING',
    classification: 'BACKGROUND',
    text: 'Models and subsystems',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 's9',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A model is a simplified representation of a system, and a large system is decomposed into smaller subsystems that can be studied on their own.',
    removable: false,
  },
  {
    id: 's10',
    type: 'HEADING',
    classification: 'BACKGROUND',
    text: 'Analysis',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 's11',
    type: 'PARAGRAPH',
    classification: 'METHOD',
    text: 'Systems analysis studies how the components interact to produce the behavior of the whole, rather than examining each part in isolation.',
    removable: false,
  },
]

const systemsArticle: SegmentationFixture = {
  name: 'systems-article',
  blocks: systemsBlocks,
  structureModel: emptyModel({
    originalOutline: [
      { heading: 'What is a system?', level: 2, sourceBlockIds: ['s0'] },
      {
        heading: 'Boundaries (and the environment around them)',
        level: 2,
        sourceBlockIds: ['s2'],
      },
      { heading: 'natural vs. man-made', level: 2, sourceBlockIds: ['s4'] },
      { heading: 'Open / closed / isolated', level: 2, sourceBlockIds: ['s6'] },
      { heading: 'Models and subsystems', level: 2, sourceBlockIds: ['s8'] },
      { heading: 'Analysis', level: 2, sourceBlockIds: ['s10'] },
    ],
    definitions: [
      {
        term: 'system',
        definition: 'interacting components forming a whole',
        sourceBlockIds: ['s1'],
      },
    ],
  }),
  // Each segment groups a heading with the paragraph it introduces — a structured
  // article folded into learning concepts even though the headings are noisy.
  llmResponse: {
    segments: [
      {
        title: 'Definition of a system',
        role: 'definition',
        sourceBlockIds: ['s0', 's1'],
        importance: 'high',
        summary:
          'A system is a set of interacting components forming an integrated whole.',
        mustPreserveClaims: [
          'a set of interacting or interdependent components',
        ],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'Boundaries and environment',
        role: 'definition',
        sourceBlockIds: ['s2', 's3'],
        importance: 'high',
        summary: 'A boundary separates a system from its environment.',
        mustPreserveClaims: [
          'a boundary that separates it from its environment',
        ],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'Natural vs human-made systems',
        role: 'distinction',
        sourceBlockIds: ['s4', 's5'],
        importance: 'medium',
        summary: 'Systems are either natural or human-made.',
        mustPreserveClaims: ['natural, such as an ecosystem'],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'Open, closed, and isolated systems',
        role: 'distinction',
        sourceBlockIds: ['s6', 's7'],
        importance: 'high',
        summary:
          'Systems are open, closed, or isolated by what crosses the boundary.',
        mustPreserveClaims: [
          'open (exchange matter and energy), closed (exchange energy only), or isolated',
        ],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'Models and subsystems',
        role: 'definition',
        sourceBlockIds: ['s8', 's9'],
        importance: 'medium',
        summary:
          'A model is a simplified representation; large systems decompose into subsystems.',
        mustPreserveClaims: ['decomposed into smaller subsystems'],
        suggestedArticlePlacement: 'main_body',
      },
      {
        title: 'Systems analysis',
        role: 'application',
        sourceBlockIds: ['s10', 's11'],
        importance: 'high',
        summary:
          'Systems analysis studies how parts interact to produce the behavior of the whole.',
        mustPreserveClaims: [
          'how the components interact to produce the behavior of the whole',
        ],
        suggestedArticlePlacement: 'main_body',
      },
    ],
    unsegmentedBlocks: [],
  },
  requiredTopics: [
    'definition',
    'boundaries',
    'environment',
    'natural vs human-made',
    'open, closed, and isolated',
    'models and subsystems',
    'analysis',
  ],
}

export const segmentationFixtures: SegmentationFixture[] = [
  transformerTranscript,
  systemsArticle,
]

export { systemsArticle, transformerTranscript }
