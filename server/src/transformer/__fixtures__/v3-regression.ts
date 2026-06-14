/**
 * v3 article-generation regression fixtures (DET-361).
 *
 * Each fixture is a hand-authored, deterministic recorded artifact (NO live LLM)
 * pairing:
 *  - `blocks`     — the classified source blocks the pipeline consumes,
 *  - `metadata`   — the thin source projection the kind detector may consult,
 *  - `article`    — a VALID `ArticleJsonV3` (the Source-Grounded Learning Article
 *                   the v3 generator is expected to produce for these blocks), and
 *  - `expectations` — the regression thresholds the suite gates on: the detected
 *                   source kind + article shape, the minimum important coverage,
 *                   concept-candidate count, retrieval-prompt count, the exact
 *                   tolerated unsupported-claim count, and the ready/blocked status.
 *
 * The fixtures pin the KNOWN article-generation failures so they cannot return:
 *  1. a Udemy-style transformer-architecture transcript,
 *  2. a structured systems / encyclopedia-style article,
 *  3. a short raw note,
 *  4. a documentation-style source,
 *  5. a research-paper-like source, and
 *  6. an intentionally BLOCKED transcript (a v3 run that regressed — a thin,
 *     untraceable article — so the suite proves the gate rejects it).
 *
 * The suite (`article-v3-regression.spec.ts`) runs the pure detector
 * (`diagnoseSource`), the schema (`ArticleJsonV3Schema`) and the metric helpers
 * (`computeRegressionMetrics` / `evaluateReleaseGate`) over each fixture — never an
 * LLM — and asserts the thresholds hold.
 */

import type { ArticleJsonV3, SourceTrace } from '../article-v3.types'
import type {
  SourceArticleShape,
  SourceDiagnosisMetadata,
  SourceKind,
} from '../source-diagnosis.types'
import type { ClassifiedBlockInput } from '../structure-model.service'

// --- helpers ---------------------------------------------------------------

/** A grounded trace — source-derived content citing real blocks. */
const g = (ids: string[]): SourceTrace => ({
  grounded: true,
  sourceBlockIds: ids,
  transformationType: 'light_reword',
  fidelityRisk: 'low',
})

/** The regression thresholds + expected diagnosis a fixture must satisfy. */
export interface V3RegressionExpectations {
  /** The kind `diagnoseSource` must detect for the blocks. */
  sourceKind: SourceKind
  /** The v3 article shape `diagnoseSource` must select (null = fallback). */
  articleShape: SourceArticleShape | null
  /** Minimum fraction of important (non-removable) blocks represented (0..1). */
  minImportantCoverage: number
  /** Minimum extracted concept candidates. */
  minConceptCandidates: number
  /** Minimum retrieval prompts. */
  minRetrievalPrompts: number
  /** Exact tolerated unsupported-claim count (0 for source-grounded mode). */
  unsupportedClaimCount: number
  /** Whether the article should be release-ready or intentionally blocked. */
  status: 'ready' | 'blocked'
}

/** A v3 regression fixture: source blocks + the expected article + thresholds. */
export interface V3RegressionFixture {
  name: string
  blocks: ClassifiedBlockInput[]
  metadata: SourceDiagnosisMetadata
  article: ArticleJsonV3
  expectations: V3RegressionExpectations
}

/** Provenance + an approving quality report shared by the READY fixtures. */
function readyProvenanceAndReport(
  sourceKind: ArticleJsonV3['provenance']['sourceKind'],
): Pick<ArticleJsonV3, 'provenance' | 'qualityReport'> {
  return {
    provenance: {
      sourceKind,
      generationMode: 'source_grounded_learning_article',
      pipelineVersion: 1,
      model: 'gpt-4o-mini',
    },
    qualityReport: {
      groundingScore: 1,
      coverageScore: 0.95,
      conceptCoverageScore: 0.9,
      approved: true,
      issues: [],
    },
  }
}

// ===========================================================================
// 1. Udemy-style transformer-architecture transcript → lesson_article
// ===========================================================================

const transcriptBlocks: ClassifiedBlockInput[] = [
  {
    id: 'bt0',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: "Okay so, um, today we're gonna walk through how a transformer block actually works, you know, end to end.",
    removable: true,
  },
  {
    id: 'bt1',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'So basically, the first thing we do is take each token and, you know, look it up in an embedding table so we get a vector for it.',
    removable: false,
  },
  {
    id: 'bt2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Now, um, the model has no idea about order, right? So we add a positional encoding to each embedding so it knows where the token sits in the sequence.',
    removable: false,
  },
  {
    id: 'bt3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: "Alright, so for self-attention, we compute three vectors per token, you know — a query, a key, and a value. That's the core of it.",
    removable: false,
  },
  {
    id: 'bt4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'So basically each query gets dot-producted against every key, and that, kind of, gives you a score for how much one token should attend to another.',
    removable: false,
  },
  {
    id: 'bt5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Then, um, we run those scores through a softmax so they turn into weights that sum to one, and we use them to take a weighted sum of the values.',
    removable: false,
  },
  {
    id: 'bt6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: "Now here's the thing — we don't just do this once, you know. We do it with multiple heads in parallel so the model can attend to different patterns at the same time.",
    removable: false,
  },
  {
    id: 'bt7',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: "So, um, after attention we add the input back in with a residual connection, right, so the gradients can flow and we don't lose the original signal.",
    removable: false,
  },
  {
    id: 'bt8',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'And then we apply layer normalization, which basically rescales the activations so their mean and variance stay stable and training stays well-conditioned.',
    removable: false,
  },
  {
    id: 'bt9',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Okay so after that, every position goes through an MLP — you know, a little feed-forward network of two linear layers applied to each token on its own.',
    removable: false,
  },
  {
    id: 'bt10',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'And between those two linear layers we stick a non-linear activation like GELU, because, um, without it the two layers would just collapse into one linear map.',
    removable: false,
  },
  {
    id: 'bt11',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'So basically you stack a bunch of these blocks on top of each other, you know, and that depth is what lets the model build up really rich representations.',
    removable: false,
  },
  {
    id: 'bt12',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: "Alright, and at the very end we project the final vectors back to vocabulary logits, and that's, you know, how we get the next-token probabilities.",
    removable: false,
  },
]

const transcriptArticle: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  sourceKind: 'transcript',
  shape: 'explainer',
  title: {
    text: 'How a Transformer block works',
    source: 'inferred',
    sourceTrace: g(['bt3']),
  },
  dek: 'A guided walk from token embeddings through attention to the next-token logits.',
  abstract: [
    {
      id: 'a1',
      text: 'A transformer turns tokens into vectors, mixes them with self-attention, refines each one through a feed-forward network, and stacks that block many times to predict the next token.',
      sourceTrace: g(['bt1', 'bt3', 'bt9', 'bt11']),
    },
  ],
  learningPath: [
    {
      id: 'lp1',
      order: 0,
      title: 'Turn tokens into vectors',
      objective: 'Explain embeddings and positional encoding.',
      sectionId: 's1',
      conceptIds: ['kc-embed', 'kc-pos'],
      sourceTrace: g(['bt1', 'bt2']),
    },
    {
      id: 'lp2',
      order: 1,
      title: 'Mix tokens with self-attention',
      objective: 'Explain query/key/value, scores, softmax weights, and heads.',
      sectionId: 's2',
      conceptIds: ['kc-qkv', 'kc-scores', 'kc-softmax', 'kc-heads'],
      sourceTrace: g(['bt3', 'bt4', 'bt5', 'bt6']),
    },
    {
      id: 'lp3',
      order: 2,
      title: 'Refine and stack',
      objective: 'Explain residuals, layer norm, the MLP, and depth.',
      sectionId: 's3',
      conceptIds: ['kc-residual', 'kc-ln', 'kc-mlp', 'kc-act'],
      sourceTrace: g(['bt7', 'bt8', 'bt9', 'bt10', 'bt11']),
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'From tokens to vectors',
      headingSource: 'inferred',
      sourceTrace: g(['bt1', 'bt2']),
      conceptIds: ['kc-embed', 'kc-pos'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Each token is looked up in an embedding table to produce a vector.',
          sourceTrace: g(['bt1']),
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'A positional encoding is added so the model knows where each token sits in the sequence.',
          sourceTrace: g(['bt2']),
        },
      ],
    },
    {
      id: 's2',
      heading: 'Self-attention',
      headingSource: 'inferred',
      sourceTrace: g(['bt3', 'bt4', 'bt5', 'bt6']),
      conceptIds: ['kc-qkv', 'kc-scores', 'kc-softmax', 'kc-heads'],
      claimIds: ['cl-softmax'],
      blocks: [
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Self-attention computes a query, a key, and a value for every token.',
          sourceTrace: g(['bt3']),
        },
        {
          id: 'p4',
          type: 'paragraph',
          text: 'Each query is dot-producted against every key to score how much one token should attend to another.',
          sourceTrace: g(['bt4']),
        },
        {
          id: 'p5',
          type: 'paragraph',
          text: 'A softmax turns those scores into weights that sum to one, used to take a weighted sum of the values.',
          sourceTrace: g(['bt5']),
        },
        {
          id: 'p6',
          type: 'paragraph',
          text: 'Multiple attention heads run in parallel so the model can attend to different patterns at once.',
          sourceTrace: g(['bt6']),
        },
      ],
    },
    {
      id: 's3',
      heading: 'Refining and stacking',
      headingSource: 'inferred',
      sourceTrace: g(['bt7', 'bt8', 'bt9', 'bt10', 'bt11', 'bt12']),
      conceptIds: ['kc-residual', 'kc-ln', 'kc-mlp', 'kc-act'],
      claimIds: ['cl-act'],
      blocks: [
        {
          id: 'p7',
          type: 'paragraph',
          text: 'A residual connection adds the input back in so gradients flow and the original signal is preserved.',
          sourceTrace: g(['bt7']),
        },
        {
          id: 'p8',
          type: 'paragraph',
          text: 'Layer normalization rescales activations so their mean and variance stay stable.',
          sourceTrace: g(['bt8']),
        },
        {
          id: 'p9',
          type: 'paragraph',
          text: 'Every position then passes through an MLP, a two-layer feed-forward network applied per token.',
          sourceTrace: g(['bt9']),
        },
        {
          id: 'p10',
          type: 'paragraph',
          text: 'A non-linear activation such as GELU sits between the two linear layers; without it they collapse into one linear map.',
          sourceTrace: g(['bt10']),
        },
        {
          id: 'p11',
          type: 'paragraph',
          text: 'Stacking many of these blocks builds up progressively richer representations.',
          sourceTrace: g(['bt11']),
        },
        {
          id: 'p12',
          type: 'paragraph',
          text: 'A final projection maps the vectors back to vocabulary logits for next-token prediction.',
          sourceTrace: g(['bt12']),
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'kc-embed',
      label: 'Token embedding',
      definition: 'The vector a token maps to via an embedding table.',
      sectionId: 's1',
      importance: 0.8,
      sourceTrace: g(['bt1']),
    },
    {
      id: 'kc-pos',
      label: 'Positional encoding',
      definition: 'Information added to each embedding so order is known.',
      sectionId: 's1',
      importance: 0.7,
      sourceTrace: g(['bt2']),
    },
    {
      id: 'kc-qkv',
      label: 'Query, key, value',
      definition: 'The three vectors self-attention derives per token.',
      sectionId: 's2',
      importance: 0.95,
      sourceTrace: g(['bt3']),
    },
    {
      id: 'kc-scores',
      label: 'Attention scores',
      definition: 'Query–key dot products measuring how tokens attend.',
      sectionId: 's2',
      importance: 0.85,
      sourceTrace: g(['bt4']),
    },
    {
      id: 'kc-softmax',
      label: 'Softmax attention weights',
      definition: 'Normalised scores that weight the value vectors.',
      sectionId: 's2',
      importance: 0.85,
      sourceTrace: g(['bt5']),
    },
    {
      id: 'kc-heads',
      label: 'Multi-head attention',
      definition: 'Several attention heads attending to different patterns.',
      sectionId: 's2',
      importance: 0.8,
      sourceTrace: g(['bt6']),
    },
    {
      id: 'kc-residual',
      label: 'Residual connection',
      definition: 'Adding the input back so gradients flow and signal is kept.',
      sectionId: 's3',
      importance: 0.75,
      sourceTrace: g(['bt7']),
    },
    {
      id: 'kc-ln',
      label: 'Layer normalization',
      definition: 'Rescaling activations to keep mean and variance stable.',
      sectionId: 's3',
      importance: 0.75,
      sourceTrace: g(['bt8']),
    },
    {
      id: 'kc-mlp',
      label: 'Feed-forward MLP',
      definition: 'A two-layer per-token network applied after attention.',
      sectionId: 's3',
      importance: 0.8,
      sourceTrace: g(['bt9']),
    },
    {
      id: 'kc-act',
      label: 'Non-linear activation',
      definition: 'The non-linearity (e.g. GELU) between the MLP layers.',
      sectionId: 's3',
      importance: 0.8,
      sourceTrace: g(['bt10']),
    },
  ],
  keyClaims: [
    {
      id: 'cl-softmax',
      statement: 'Softmax turns attention scores into weights that sum to one.',
      claimType: 'fact',
      sectionId: 's2',
      sourceTrace: g(['bt5']),
    },
    {
      id: 'cl-act',
      statement:
        'Without a non-linear activation the MLP’s two linear layers collapse into a single linear map.',
      claimType: 'causal',
      sectionId: 's3',
      sourceTrace: g(['bt10']),
    },
    {
      id: 'cl-depth',
      statement:
        'Stacking more transformer blocks yields richer representations.',
      claimType: 'causal',
      sectionId: 's3',
      sourceTrace: g(['bt11']),
    },
  ],
  terminology: [
    {
      id: 'tm-logits',
      term: 'Logits',
      definition: 'The pre-softmax vocabulary scores for the next token.',
      sourceTrace: g(['bt12']),
    },
  ],
  sourceExamples: [],
  misconceptionWarnings: [
    {
      id: 'mc-act',
      misconception:
        'Two stacked linear layers add expressive power on their own.',
      correction:
        'Without a non-linearity between them they collapse into one linear map.',
      sectionId: 's3',
      sourceTrace: g(['bt10']),
    },
  ],
  retrievalPrompts: [
    {
      id: 'rp1',
      prompt: 'How does a token become a vector at the input of a transformer?',
      answer: 'It is looked up in an embedding table.',
      conceptIds: ['kc-embed'],
      sourceTrace: g(['bt1']),
    },
    {
      id: 'rp2',
      prompt: 'Why is a positional encoding added to the embeddings?',
      answer: 'So the model knows where each token sits in the sequence.',
      conceptIds: ['kc-pos'],
      sourceTrace: g(['bt2']),
    },
    {
      id: 'rp3',
      prompt: 'What three vectors does self-attention compute per token?',
      answer: 'A query, a key, and a value.',
      conceptIds: ['kc-qkv'],
      sourceTrace: g(['bt3']),
    },
    {
      id: 'rp4',
      prompt: 'What does the softmax do to the attention scores?',
      answer: 'Turns them into weights that sum to one over the values.',
      conceptIds: ['kc-softmax'],
      sourceTrace: g(['bt5']),
    },
    {
      id: 'rp5',
      prompt: 'Why must the MLP include a non-linear activation?',
      answer:
        'Otherwise its two linear layers collapse into a single linear map.',
      conceptIds: ['kc-act'],
      sourceTrace: g(['bt10']),
    },
    {
      id: 'rp6',
      prompt: 'What does layer normalization stabilise?',
      answer: 'The mean and variance of the activations at each layer.',
      conceptIds: ['kc-ln'],
      sourceTrace: g(['bt8']),
    },
  ],
  calloutPlacements: { bySection: {}, unplaced: [] },
  tables: [],
  sourceNotes: [],
  references: [],
  ...readyProvenanceAndReport('transcript'),
}

export const transcriptLessonRegression: V3RegressionFixture = {
  name: 'transcript-lesson',
  blocks: transcriptBlocks,
  metadata: { sourceType: 'TEXT' },
  article: transcriptArticle,
  expectations: {
    sourceKind: 'transcript_lesson',
    articleShape: 'lesson_article',
    minImportantCoverage: 0.8,
    minConceptCandidates: 8,
    minRetrievalPrompts: 5,
    unsupportedClaimCount: 0,
    status: 'ready',
  },
}

// ===========================================================================
// 2. Structured systems / encyclopedia-style article → concept_explainer
// ===========================================================================

const systemsBlocks: ClassifiedBlockInput[] = [
  {
    id: 'sh1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Systems theory',
    removable: true,
  },
  {
    id: 'sb1',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A system is a set of interacting or interdependent components that together form an integrated whole directed toward a purpose.',
    removable: false,
  },
  {
    id: 'sb2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The components of a system are the individual parts whose properties and behaviour the system is built from and depends upon.',
    removable: false,
  },
  {
    id: 'sb3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Interconnection refers to the relationships through which components influence one another, so the behaviour of the whole exceeds the sum of the isolated parts.',
    removable: false,
  },
  {
    id: 'sh2',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Boundary and environment',
    removable: true,
  },
  {
    id: 'sb4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The boundary of a system is the conceptual or physical line that distinguishes what belongs to the system from what does not.',
    removable: false,
  },
  {
    id: 'sb5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'The environment is everything outside the boundary that can affect the system or be affected by it through exchanges across that boundary.',
    removable: false,
  },
  {
    id: 'sh3',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Classifying systems',
    removable: true,
  },
  {
    id: 'sb6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'An open system exchanges both matter and energy with its environment, continually drawing on and releasing resources across its boundary.',
    removable: false,
  },
  {
    id: 'sb7',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A closed system exchanges energy with its environment but not matter, so its material contents remain fixed while heat or work may cross.',
    removable: false,
  },
  {
    id: 'sb8',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'An isolated system exchanges neither matter nor energy with its environment and is an idealisation rarely realised in practice.',
    removable: false,
  },
  {
    id: 'sb9',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A transformation process is the activity by which a system converts inputs drawn from its environment into outputs returned to it.',
    removable: false,
  },
  {
    id: 'sh4',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Feedback and control',
    removable: true,
  },
  {
    id: 'sb10',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A feedback loop occurs when part of a system’s output is routed back as input, allowing the system to regulate its own behaviour over time.',
    removable: false,
  },
  {
    id: 'sb11',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Homeostasis is the maintenance of a stable internal state through negative feedback that counteracts disturbances from the environment.',
    removable: false,
  },
  {
    id: 'sh5',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Emergence',
    removable: true,
  },
  {
    id: 'sb12',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Emergence is the appearance of properties at the level of the whole system that none of its components exhibits in isolation.',
    removable: false,
  },
]

const systemsArticleV3: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  sourceKind: 'article',
  shape: 'explainer',
  title: {
    text: 'What is a system?',
    source: 'original',
    sourceTrace: g(['sb1']),
  },
  dek: 'Components, boundaries, classification, feedback, and emergence.',
  abstract: [
    {
      id: 'a1',
      text: 'A system is interacting components within a boundary; what crosses that boundary classifies it, feedback regulates it, and emergence gives the whole properties its parts lack.',
      sourceTrace: g(['sb1', 'sb4', 'sb6', 'sb10', 'sb12']),
    },
  ],
  learningPath: [
    {
      id: 'lp1',
      order: 0,
      title: 'Define a system',
      objective: 'Explain components and interconnection.',
      sectionId: 's1',
      conceptIds: ['kc-system', 'kc-component', 'kc-interconnection'],
      sourceTrace: g(['sb1', 'sb2', 'sb3']),
    },
    {
      id: 'lp2',
      order: 1,
      title: 'Locate the boundary',
      objective: 'Distinguish a system from its environment.',
      sectionId: 's2',
      conceptIds: ['kc-boundary', 'kc-environment'],
      sourceTrace: g(['sb4', 'sb5']),
    },
    {
      id: 'lp3',
      order: 2,
      title: 'Classify and regulate',
      objective: 'Tell open/closed/isolated apart and explain feedback.',
      sectionId: 's3',
      conceptIds: ['kc-open', 'kc-closed', 'kc-isolated', 'kc-feedback'],
      sourceTrace: g(['sb6', 'sb7', 'sb8', 'sb10']),
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Systems and their parts',
      headingSource: 'original',
      headingSourceBlockIds: ['sh1'],
      sourceTrace: g(['sb1', 'sb2', 'sb3']),
      conceptIds: ['kc-system', 'kc-component', 'kc-interconnection'],
      claimIds: ['cl-whole'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'A system is interacting components forming an integrated whole with a purpose.',
          sourceTrace: g(['sb1']),
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Components are the individual parts the system is built from.',
          sourceTrace: g(['sb2']),
        },
        {
          id: 'p3',
          type: 'paragraph',
          text: 'Interconnections let components influence one another, so the whole exceeds the parts.',
          sourceTrace: g(['sb3']),
        },
      ],
    },
    {
      id: 's2',
      heading: 'Boundary and environment',
      headingSource: 'original',
      headingSourceBlockIds: ['sh2'],
      sourceTrace: g(['sb4', 'sb5']),
      conceptIds: ['kc-boundary', 'kc-environment'],
      blocks: [
        {
          id: 'p4',
          type: 'paragraph',
          text: 'The boundary distinguishes what belongs to the system from what does not.',
          sourceTrace: g(['sb4']),
        },
        {
          id: 'p5',
          type: 'paragraph',
          text: 'The environment is everything outside the boundary that interacts with the system.',
          sourceTrace: g(['sb5']),
        },
      ],
    },
    {
      id: 's3',
      heading: 'Kinds of system and their control',
      headingSource: 'original',
      headingSourceBlockIds: ['sh3'],
      sourceTrace: g(['sb6', 'sb7', 'sb8', 'sb9', 'sb10', 'sb11']),
      conceptIds: [
        'kc-open',
        'kc-closed',
        'kc-isolated',
        'kc-transform',
        'kc-feedback',
        'kc-homeostasis',
      ],
      claimIds: ['cl-closed'],
      blocks: [
        {
          id: 'p6',
          type: 'list',
          ordered: false,
          items: [
            'Open: exchanges matter and energy.',
            'Closed: exchanges energy but not matter.',
            'Isolated: exchanges neither.',
          ],
          sourceTrace: g(['sb6', 'sb7', 'sb8']),
        },
        {
          id: 'p7',
          type: 'paragraph',
          text: 'A transformation process converts inputs into outputs.',
          sourceTrace: g(['sb9']),
        },
        {
          id: 'p8',
          type: 'paragraph',
          text: 'A feedback loop routes output back as input so the system regulates itself.',
          sourceTrace: g(['sb10']),
        },
        {
          id: 'p9',
          type: 'paragraph',
          text: 'Homeostasis keeps a stable internal state through negative feedback.',
          sourceTrace: g(['sb11']),
        },
      ],
    },
    {
      id: 's4',
      heading: 'Emergence',
      headingSource: 'original',
      headingSourceBlockIds: ['sh5'],
      sourceTrace: g(['sb12']),
      conceptIds: ['kc-emergence'],
      blocks: [
        {
          id: 'p10',
          type: 'paragraph',
          text: 'Emergence is whole-system properties that no component shows alone.',
          sourceTrace: g(['sb12']),
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'kc-system',
      label: 'System',
      definition: 'Interacting components forming an integrated whole.',
      sectionId: 's1',
      importance: 0.95,
      sourceTrace: g(['sb1']),
    },
    {
      id: 'kc-component',
      label: 'Component',
      definition: 'An individual part of a system.',
      sectionId: 's1',
      importance: 0.6,
      sourceTrace: g(['sb2']),
    },
    {
      id: 'kc-interconnection',
      label: 'Interconnection',
      definition:
        'Relationships through which components influence one another.',
      sectionId: 's1',
      importance: 0.7,
      sourceTrace: g(['sb3']),
    },
    {
      id: 'kc-boundary',
      label: 'Boundary',
      definition: 'What separates a system from what is not part of it.',
      sectionId: 's2',
      importance: 0.85,
      sourceTrace: g(['sb4']),
    },
    {
      id: 'kc-environment',
      label: 'Environment',
      definition:
        'Everything outside the boundary that interacts with the system.',
      sectionId: 's2',
      importance: 0.8,
      sourceTrace: g(['sb5']),
    },
    {
      id: 'kc-open',
      label: 'Open system',
      definition: 'Exchanges both matter and energy with its environment.',
      sectionId: 's3',
      importance: 0.85,
      sourceTrace: g(['sb6']),
    },
    {
      id: 'kc-closed',
      label: 'Closed system',
      definition: 'Exchanges energy but not matter.',
      sectionId: 's3',
      importance: 0.85,
      sourceTrace: g(['sb7']),
    },
    {
      id: 'kc-isolated',
      label: 'Isolated system',
      definition: 'Exchanges neither matter nor energy.',
      sectionId: 's3',
      importance: 0.8,
      sourceTrace: g(['sb8']),
    },
    {
      id: 'kc-transform',
      label: 'Transformation process',
      definition: 'How a system converts inputs into outputs.',
      sectionId: 's3',
      importance: 0.7,
      sourceTrace: g(['sb9']),
    },
    {
      id: 'kc-feedback',
      label: 'Feedback loop',
      definition: 'Output routed back as input for self-regulation.',
      sectionId: 's3',
      importance: 0.8,
      sourceTrace: g(['sb10']),
    },
    {
      id: 'kc-homeostasis',
      label: 'Homeostasis',
      definition: 'A stable internal state maintained by negative feedback.',
      sectionId: 's3',
      importance: 0.7,
      sourceTrace: g(['sb11']),
    },
    {
      id: 'kc-emergence',
      label: 'Emergence',
      definition: 'Whole-system properties absent from any component.',
      sectionId: 's4',
      importance: 0.8,
      sourceTrace: g(['sb12']),
    },
  ],
  keyClaims: [
    {
      id: 'cl-whole',
      statement: 'A system’s behaviour exceeds the sum of its isolated parts.',
      claimType: 'fact',
      sectionId: 's1',
      sourceTrace: g(['sb3']),
    },
    {
      id: 'cl-closed',
      statement: 'A closed system exchanges energy but not matter.',
      claimType: 'definition',
      sectionId: 's3',
      sourceTrace: g(['sb7']),
    },
    {
      id: 'cl-emergence',
      statement:
        'Emergent properties are absent from the components in isolation.',
      claimType: 'fact',
      sectionId: 's4',
      sourceTrace: g(['sb12']),
    },
  ],
  terminology: [
    {
      id: 'tm-boundary',
      term: 'Boundary',
      definition: 'The line distinguishing a system from its environment.',
      sourceTrace: g(['sb4']),
    },
    {
      id: 'tm-feedback',
      term: 'Feedback',
      definition: 'Output routed back into a system as input.',
      sourceTrace: g(['sb10']),
    },
  ],
  sourceExamples: [
    {
      id: 'ex1',
      text: 'A thermostat-controlled room exchanges heat, so it is not isolated.',
      sectionId: 's3',
      sourceTrace: g(['sb6']),
    },
  ],
  misconceptionWarnings: [
    {
      id: 'mc-closed',
      misconception: 'A closed system exchanges nothing with its environment.',
      correction:
        'A closed system still exchanges energy; only an isolated system exchanges neither.',
      sectionId: 's3',
      sourceTrace: g(['sb7', 'sb8']),
    },
  ],
  retrievalPrompts: [
    {
      id: 'rp1',
      prompt: 'What is a system?',
      answer:
        'Interacting components forming an integrated whole with a purpose.',
      conceptIds: ['kc-system'],
      sourceTrace: g(['sb1']),
    },
    {
      id: 'rp2',
      prompt: 'What does a system’s boundary separate?',
      answer: 'The system from its environment.',
      conceptIds: ['kc-boundary'],
      sourceTrace: g(['sb4']),
    },
    {
      id: 'rp3',
      prompt: 'How do open, closed, and isolated systems differ?',
      answer: 'By whether matter and/or energy cross the boundary.',
      conceptIds: ['kc-open', 'kc-closed', 'kc-isolated'],
      sourceTrace: g(['sb6', 'sb7', 'sb8']),
    },
    {
      id: 'rp4',
      prompt: 'What does a feedback loop let a system do?',
      answer: 'Regulate its own behaviour by routing output back as input.',
      conceptIds: ['kc-feedback'],
      sourceTrace: g(['sb10']),
    },
    {
      id: 'rp5',
      prompt: 'What is emergence?',
      answer: 'Whole-system properties no component shows in isolation.',
      conceptIds: ['kc-emergence'],
      sourceTrace: g(['sb12']),
    },
  ],
  calloutPlacements: { bySection: {}, unplaced: [] },
  tables: [],
  sourceNotes: [],
  references: [],
  ...readyProvenanceAndReport('article'),
}

export const systemsExplainerRegression: V3RegressionFixture = {
  name: 'systems-explainer',
  blocks: systemsBlocks,
  metadata: { sourceType: 'URL', url: 'https://en.wikipedia.org/wiki/System' },
  article: systemsArticleV3,
  expectations: {
    sourceKind: 'structured_web_article',
    articleShape: 'concept_explainer',
    minImportantCoverage: 0.7,
    minConceptCandidates: 10,
    minRetrievalPrompts: 5,
    unsupportedClaimCount: 0,
    status: 'ready',
  },
}

// ===========================================================================
// 3. Short raw note → structured_notes
// ===========================================================================

const rawNoteBlocks: ClassifiedBlockInput[] = [
  {
    id: 'n1',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'mtg notes - routing project',
    removable: false,
  },
  {
    id: 'n2',
    type: 'LIST',
    classification: 'CORE',
    text: 'ship v2 first\ncheck latency\nask Dana re: budget',
    removable: false,
  },
  {
    id: 'n3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'todo: refactor cache',
    removable: false,
  },
  {
    id: 'n4',
    type: 'LIST',
    classification: 'CORE',
    text: 'q3 goals\nhiring\noffsite?',
    removable: false,
  },
  {
    id: 'n5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'follow up next week',
    removable: false,
  },
]

const rawNoteArticle: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  sourceKind: 'plain_text',
  shape: 'narrative',
  title: {
    text: 'Routing project — meeting notes',
    source: 'inferred',
    sourceTrace: g(['n1']),
  },
  abstract: [
    {
      id: 'a1',
      text: 'Notes from the routing project meeting: ship v2, watch latency, settle budget, and refactor the cache.',
      sourceTrace: g(['n1', 'n2', 'n3']),
    },
  ],
  learningPath: [
    {
      id: 'lp1',
      order: 0,
      title: 'Review the action items',
      objective: 'Recall the immediate next steps.',
      sectionId: 's1',
      conceptIds: ['kc-ship', 'kc-cache'],
      sourceTrace: g(['n2', 'n3']),
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Action items',
      headingSource: 'inferred',
      sourceTrace: g(['n1', 'n2', 'n3']),
      conceptIds: ['kc-ship', 'kc-latency', 'kc-cache'],
      blocks: [
        {
          id: 'p1',
          type: 'list',
          ordered: false,
          items: ['Ship v2 first', 'Check latency', 'Ask Dana about budget'],
          sourceTrace: g(['n2']),
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'Refactor the cache.',
          sourceTrace: g(['n3']),
        },
      ],
    },
    {
      id: 's2',
      heading: 'Planning',
      headingSource: 'inferred',
      sourceTrace: g(['n4']),
      blocks: [
        {
          id: 'p3',
          type: 'list',
          ordered: false,
          items: ['Q3 goals', 'Hiring', 'Offsite?'],
          sourceTrace: g(['n4']),
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'kc-ship',
      label: 'Ship v2 first',
      definition: 'Releasing v2 before later work.',
      sectionId: 's1',
      importance: 0.8,
      sourceTrace: g(['n2']),
    },
    {
      id: 'kc-latency',
      label: 'Latency check',
      definition: 'Verifying response latency.',
      sectionId: 's1',
      importance: 0.6,
      sourceTrace: g(['n2']),
    },
    {
      id: 'kc-cache',
      label: 'Cache refactor',
      definition: 'Reworking the cache implementation.',
      sectionId: 's1',
      importance: 0.6,
      sourceTrace: g(['n3']),
    },
  ],
  keyClaims: [],
  terminology: [],
  sourceExamples: [],
  misconceptionWarnings: [],
  retrievalPrompts: [
    {
      id: 'rp1',
      prompt: 'What is the first thing to ship?',
      answer: 'v2.',
      conceptIds: ['kc-ship'],
      sourceTrace: g(['n2']),
    },
    {
      id: 'rp2',
      prompt: 'What needs refactoring?',
      answer: 'The cache.',
      conceptIds: ['kc-cache'],
      sourceTrace: g(['n3']),
    },
  ],
  calloutPlacements: { bySection: {}, unplaced: [] },
  tables: [],
  sourceNotes: [
    {
      id: 'sn1',
      kind: 'gap',
      text: 'The notes never define what "v2" includes.',
      sourceTrace: g(['n2']),
    },
  ],
  references: [],
  ...readyProvenanceAndReport('plain_text'),
}

export const rawNoteRegression: V3RegressionFixture = {
  name: 'raw-note',
  blocks: rawNoteBlocks,
  metadata: { sourceType: 'TEXT' },
  article: rawNoteArticle,
  expectations: {
    sourceKind: 'raw_notes',
    articleShape: 'structured_notes',
    minImportantCoverage: 0.6,
    minConceptCandidates: 2,
    minRetrievalPrompts: 1,
    unsupportedClaimCount: 0,
    status: 'ready',
  },
}

// ===========================================================================
// 4. Documentation-style source → technical_walkthrough
// ===========================================================================

const documentationBlocks: ClassifiedBlockInput[] = [
  {
    id: 'd1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Installation',
    removable: true,
  },
  {
    id: 'd2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Install the package from npm before importing it into your project.',
    removable: false,
  },
  {
    id: 'd3',
    type: 'CODE',
    classification: 'CORE',
    text: 'npm install @acme/widget',
    removable: false,
  },
  {
    id: 'd4',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Usage',
    removable: true,
  },
  {
    id: 'd5',
    type: 'CODE',
    classification: 'CORE',
    text: "import { Widget } from '@acme/widget'\nconst w = new Widget({ size: 4 })\nw.render()",
    removable: false,
  },
  {
    id: 'd6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Call render() after configuring the widget options described below.',
    removable: false,
  },
]

const documentationArticle: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  sourceKind: 'documentation',
  shape: 'procedure',
  title: {
    text: 'Getting started with @acme/widget',
    source: 'inferred',
    sourceTrace: g(['d2']),
  },
  abstract: [
    {
      id: 'a1',
      text: 'Install @acme/widget from npm, import and construct it, then call render() after setting its options.',
      sourceTrace: g(['d2', 'd5', 'd6']),
    },
  ],
  learningPath: [
    {
      id: 'lp1',
      order: 0,
      title: 'Install and render',
      objective: 'Install the package and render a widget.',
      sectionId: 's1',
      conceptIds: ['kc-install', 'kc-render'],
      sourceTrace: g(['d3', 'd5']),
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Install',
      headingSource: 'original',
      headingSourceBlockIds: ['d1'],
      sourceTrace: g(['d2', 'd3']),
      sectionRole: 'step',
      conceptIds: ['kc-install'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Install the package from npm first.',
          sourceTrace: g(['d2']),
        },
        {
          id: 'p2',
          type: 'code',
          text: 'npm install @acme/widget',
          language: 'bash',
          sourceTrace: g(['d3']),
        },
      ],
    },
    {
      id: 's2',
      heading: 'Use',
      headingSource: 'original',
      headingSourceBlockIds: ['d4'],
      sourceTrace: g(['d5', 'd6']),
      sectionRole: 'step',
      conceptIds: ['kc-widget', 'kc-render'],
      blocks: [
        {
          id: 'p3',
          type: 'code',
          text: "import { Widget } from '@acme/widget'\nconst w = new Widget({ size: 4 })\nw.render()",
          language: 'ts',
          sourceTrace: g(['d5']),
        },
        {
          id: 'p4',
          type: 'paragraph',
          text: 'Call render() after configuring the widget options.',
          sourceTrace: g(['d6']),
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'kc-install',
      label: 'Installing the package',
      definition: 'Adding @acme/widget via npm.',
      sectionId: 's1',
      importance: 0.8,
      sourceTrace: g(['d3']),
    },
    {
      id: 'kc-widget',
      label: 'Widget constructor',
      definition: 'Creating a Widget with options.',
      sectionId: 's2',
      importance: 0.8,
      sourceTrace: g(['d5']),
    },
    {
      id: 'kc-render',
      label: 'render()',
      definition: 'Rendering the configured widget.',
      sectionId: 's2',
      importance: 0.7,
      sourceTrace: g(['d6']),
    },
  ],
  keyClaims: [
    {
      id: 'cl-order',
      statement:
        'render() should be called after configuring the widget options.',
      claimType: 'fact',
      sectionId: 's2',
      sourceTrace: g(['d6']),
    },
  ],
  terminology: [
    {
      id: 'tm-widget',
      term: 'Widget',
      definition: 'The component class exported by @acme/widget.',
      sourceTrace: g(['d5']),
    },
  ],
  sourceExamples: [
    {
      id: 'ex1',
      text: 'new Widget({ size: 4 }).render()',
      label: 'Minimal usage',
      sectionId: 's2',
      sourceTrace: g(['d5']),
    },
  ],
  misconceptionWarnings: [],
  retrievalPrompts: [
    {
      id: 'rp1',
      prompt: 'How do you install @acme/widget?',
      answer: 'npm install @acme/widget',
      conceptIds: ['kc-install'],
      sourceTrace: g(['d3']),
    },
    {
      id: 'rp2',
      prompt: 'How do you construct a Widget?',
      answer: 'new Widget({ size: 4 })',
      conceptIds: ['kc-widget'],
      sourceTrace: g(['d5']),
    },
    {
      id: 'rp3',
      prompt: 'When should render() be called?',
      answer: 'After configuring the widget options.',
      conceptIds: ['kc-render'],
      sourceTrace: g(['d6']),
    },
  ],
  calloutPlacements: { bySection: {}, unplaced: [] },
  tables: [],
  sourceNotes: [],
  references: [],
  ...readyProvenanceAndReport('documentation'),
}

export const documentationRegression: V3RegressionFixture = {
  name: 'documentation',
  blocks: documentationBlocks,
  metadata: { sourceType: 'URL', url: 'https://docs.acme.dev/widget' },
  article: documentationArticle,
  expectations: {
    sourceKind: 'documentation',
    articleShape: 'technical_walkthrough',
    minImportantCoverage: 0.75,
    minConceptCandidates: 3,
    minRetrievalPrompts: 3,
    unsupportedClaimCount: 0,
    status: 'ready',
  },
}

// ===========================================================================
// 5. Research-paper-like source → research_digest
// ===========================================================================

const researchBlocks: ClassifiedBlockInput[] = [
  {
    id: 'r1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Abstract',
    removable: true,
  },
  {
    id: 'r2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'We present a method for stabilising expert routing in sparse mixture-of-experts models as they scale beyond one trillion parameters.',
    removable: false,
  },
  {
    id: 'r3',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Introduction',
    removable: true,
  },
  {
    id: 'r4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Prior work has shown that routing collapses at scale [1], and that load-balancing losses only partially mitigate it (Smith et al., 2021).',
    removable: false,
  },
  {
    id: 'r5',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Methods',
    removable: true,
  },
  {
    id: 'r6',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'We anneal the auxiliary load-balancing coefficient over training and measure routing entropy across 12 checkpoints, following the protocol of Jones et al. (2020) [2].',
    removable: false,
  },
  {
    id: 'r7',
    type: 'HEADING',
    classification: 'CORE',
    text: 'References',
    removable: true,
  },
  {
    id: 'r8',
    type: 'PARAGRAPH',
    classification: 'CITATION',
    text: '[1] Shazeer et al. (2017). Outrageously large neural networks. doi:10.48550/arXiv.1701.06538',
    removable: false,
  },
]

const researchArticle: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  sourceKind: 'academic_paper',
  shape: 'report',
  title: {
    text: 'Stabilising expert routing in trillion-parameter MoE models',
    source: 'inferred',
    sourceTrace: g(['r2']),
  },
  abstract: [
    {
      id: 'a1',
      text: 'A method that anneals the load-balancing coefficient to stabilise expert routing in sparse mixture-of-experts models at trillion-parameter scale.',
      sourceTrace: g(['r2', 'r6']),
    },
  ],
  learningPath: [
    {
      id: 'lp1',
      order: 0,
      title: 'Understand the problem',
      objective: 'Explain routing collapse at scale.',
      sectionId: 's1',
      conceptIds: ['kc-moe', 'kc-collapse'],
      sourceTrace: g(['r2', 'r4']),
    },
    {
      id: 'lp2',
      order: 1,
      title: 'Understand the method',
      objective: 'Explain annealing the load-balancing coefficient.',
      sectionId: 's2',
      conceptIds: ['kc-loadbalance', 'kc-entropy'],
      sourceTrace: g(['r6']),
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Problem',
      headingSource: 'inferred',
      sourceTrace: g(['r2', 'r4']),
      sectionRole: 'background',
      conceptIds: ['kc-moe', 'kc-routing', 'kc-collapse'],
      claimIds: ['cl-collapse'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Sparse mixture-of-experts models route each token to a few experts, but routing collapses as the model scales.',
          sourceTrace: g(['r2', 'r4']),
        },
      ],
    },
    {
      id: 's2',
      heading: 'Method',
      headingSource: 'original',
      headingSourceBlockIds: ['r5'],
      sourceTrace: g(['r6']),
      sectionRole: 'evidence',
      conceptIds: ['kc-loadbalance', 'kc-entropy'],
      blocks: [
        {
          id: 'p2',
          type: 'paragraph',
          text: 'The auxiliary load-balancing coefficient is annealed over training while routing entropy is measured across checkpoints.',
          sourceTrace: g(['r6']),
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'kc-moe',
      label: 'Mixture-of-experts',
      definition: 'A sparse model routing tokens to a subset of experts.',
      sectionId: 's1',
      importance: 0.9,
      sourceTrace: g(['r2']),
    },
    {
      id: 'kc-routing',
      label: 'Expert routing',
      definition: 'Assigning each token to experts.',
      sectionId: 's1',
      importance: 0.85,
      sourceTrace: g(['r4']),
    },
    {
      id: 'kc-collapse',
      label: 'Routing collapse',
      definition: 'Degenerate routing that worsens with scale.',
      sectionId: 's1',
      importance: 0.85,
      sourceTrace: g(['r4']),
    },
    {
      id: 'kc-loadbalance',
      label: 'Load-balancing loss',
      definition: 'An auxiliary loss encouraging even expert use.',
      sectionId: 's2',
      importance: 0.8,
      sourceTrace: g(['r6']),
    },
    {
      id: 'kc-entropy',
      label: 'Routing entropy',
      definition: 'A measure of how spread routing decisions are.',
      sectionId: 's2',
      importance: 0.7,
      sourceTrace: g(['r6']),
    },
  ],
  keyClaims: [
    {
      id: 'cl-collapse',
      statement: 'Expert routing collapses as mixture-of-experts models scale.',
      claimType: 'fact',
      sectionId: 's1',
      sourceTrace: g(['r4']),
    },
    {
      id: 'cl-mitigate',
      statement:
        'Load-balancing losses only partially mitigate routing collapse.',
      claimType: 'fact',
      sectionId: 's1',
      sourceTrace: g(['r4']),
    },
  ],
  terminology: [
    {
      id: 'tm-moe',
      term: 'Sparse MoE',
      definition:
        'A mixture-of-experts model activating few experts per token.',
      sourceTrace: g(['r2']),
    },
  ],
  sourceExamples: [],
  misconceptionWarnings: [],
  retrievalPrompts: [
    {
      id: 'rp1',
      prompt: 'What does a mixture-of-experts model do?',
      answer: 'Routes each token to a subset of experts.',
      conceptIds: ['kc-moe'],
      sourceTrace: g(['r2']),
    },
    {
      id: 'rp2',
      prompt: 'What happens to routing as the model scales?',
      answer: 'It collapses.',
      conceptIds: ['kc-collapse'],
      sourceTrace: g(['r4']),
    },
    {
      id: 'rp3',
      prompt: 'What is annealed in the proposed method?',
      answer: 'The auxiliary load-balancing coefficient.',
      conceptIds: ['kc-loadbalance'],
      sourceTrace: g(['r6']),
    },
    {
      id: 'rp4',
      prompt: 'What is measured across checkpoints?',
      answer: 'Routing entropy.',
      conceptIds: ['kc-entropy'],
      sourceTrace: g(['r6']),
    },
  ],
  calloutPlacements: { bySection: {}, unplaced: [] },
  tables: [],
  sourceNotes: [],
  references: [
    {
      id: 'ref1',
      citationText:
        '[1] Shazeer et al. (2017). Outrageously large neural networks.',
      url: 'https://doi.org/10.48550/arXiv.1701.06538',
      sourceTrace: g(['r8']),
    },
  ],
  ...readyProvenanceAndReport('academic_paper'),
}

export const researchPaperRegression: V3RegressionFixture = {
  name: 'research-paper',
  blocks: researchBlocks,
  metadata: { sourceType: 'PDF', fileName: 'moe-routing.pdf', pageCount: 12 },
  article: researchArticle,
  expectations: {
    sourceKind: 'research_paper',
    articleShape: 'research_digest',
    minImportantCoverage: 0.75,
    minConceptCandidates: 4,
    minRetrievalPrompts: 4,
    unsupportedClaimCount: 0,
    status: 'ready',
  },
}

// ===========================================================================
// 6. Intentionally BLOCKED transcript (a regressed v3 run)
// ===========================================================================
//
// This is the NEGATIVE regression: a transcript source that the generator
// botched — it extracted almost no concepts and asserted a claim citing a block
// the source never contained ('bghost'). The schema still ACCEPTS it (a grounded
// trace need only cite *something*), but the code-level metrics catch it:
// `unsupportedClaimCount` is 1 and the quality report does NOT approve, so the
// status is `blocked`. The suite proves the gate rejects this output.

const blockedTranscriptBlocks: ClassifiedBlockInput[] = [
  {
    id: 'g0',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: "Okay so, um, let's get into it, you know.",
    removable: true,
  },
  {
    id: 'g1',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'So basically, you know, backpropagation is how we compute the gradient of the loss with respect to every weight in the network.',
    removable: false,
  },
  {
    id: 'g2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'I mean, we apply the chain rule backwards through the layers, right, so each layer gets, kind of, its share of the error signal.',
    removable: false,
  },
  {
    id: 'g3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'And then, um, the optimizer uses those gradients to nudge the weights downhill, you know, a little bit each step.',
    removable: false,
  },
  {
    id: 'g4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'So basically the learning rate controls how big that nudge is, and if we, like, set it too high the training just blows up.',
    removable: false,
  },
]

const blockedTranscriptArticle: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  sourceKind: 'transcript',
  shape: 'explainer',
  title: {
    text: 'Backpropagation',
    source: 'inferred',
    sourceTrace: g(['g1']),
  },
  abstract: [
    {
      id: 'a1',
      text: 'Backpropagation computes gradients of the loss with respect to the weights.',
      sourceTrace: g(['g1']),
    },
  ],
  learningPath: [
    {
      id: 'lp1',
      order: 0,
      title: 'Understand backprop',
      objective: 'Explain how gradients are computed.',
      sectionId: 's1',
      conceptIds: ['kc-backprop'],
      sourceTrace: g(['g1']),
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Backpropagation',
      headingSource: 'inferred',
      sourceTrace: g(['g1', 'g2']),
      conceptIds: ['kc-backprop'],
      claimIds: ['cl-ghost'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'Backpropagation computes the gradient of the loss for every weight.',
          sourceTrace: g(['g1']),
        },
        {
          id: 'p2',
          type: 'paragraph',
          text: 'The chain rule is applied backwards through the layers.',
          sourceTrace: g(['g2']),
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'kc-backprop',
      label: 'Backpropagation',
      definition: 'Computing weight gradients via the chain rule.',
      sectionId: 's1',
      importance: 0.9,
      sourceTrace: g(['g1']),
    },
  ],
  keyClaims: [
    // The traceability break: this claim cites a block the source never had.
    {
      id: 'cl-ghost',
      statement:
        'Backpropagation guarantees convergence to the global minimum.',
      claimType: 'causal',
      sectionId: 's1',
      sourceTrace: g(['gghost']),
    },
  ],
  terminology: [],
  sourceExamples: [],
  misconceptionWarnings: [],
  retrievalPrompts: [
    {
      id: 'rp1',
      prompt: 'What does backpropagation compute?',
      answer: 'Gradients of the loss with respect to the weights.',
      conceptIds: ['kc-backprop'],
      sourceTrace: g(['g1']),
    },
  ],
  calloutPlacements: { bySection: {}, unplaced: [] },
  tables: [],
  sourceNotes: [],
  references: [],
  provenance: {
    sourceKind: 'transcript',
    generationMode: 'source_grounded_learning_article',
    pipelineVersion: 1,
    model: 'gpt-4o-mini',
  },
  qualityReport: {
    groundingScore: 0.7,
    coverageScore: 0.4,
    conceptCoverageScore: 0.2,
    approved: false,
    issues: [
      {
        severity: 'high',
        category: 'ungrounded_content',
        description: 'A key claim cites a source block that does not exist.',
        articleRef: 'cl-ghost',
        sourceBlockIds: ['gghost'],
      },
      {
        severity: 'high',
        category: 'low_concept_coverage',
        description:
          'Only one concept was extracted from a concept-rich transcript.',
      },
    ],
  },
}

export const blockedTranscriptRegression: V3RegressionFixture = {
  name: 'blocked-transcript',
  blocks: blockedTranscriptBlocks,
  metadata: { sourceType: 'TEXT' },
  article: blockedTranscriptArticle,
  expectations: {
    sourceKind: 'transcript_lesson',
    articleShape: 'lesson_article',
    minImportantCoverage: 0,
    minConceptCandidates: 0,
    minRetrievalPrompts: 0,
    unsupportedClaimCount: 1,
    status: 'blocked',
  },
}

// --- registry --------------------------------------------------------------

/** Every regression fixture (ready + blocked). */
export const v3RegressionFixtures: V3RegressionFixture[] = [
  transcriptLessonRegression,
  systemsExplainerRegression,
  rawNoteRegression,
  documentationRegression,
  researchPaperRegression,
  blockedTranscriptRegression,
]

/** The READY fixtures — release-eligible outputs that must clear every gate. */
export const readyRegressionFixtures: V3RegressionFixture[] =
  v3RegressionFixtures.filter((f) => f.expectations.status === 'ready')

/** The BLOCKED fixtures — intentionally rejected outputs. */
export const blockedRegressionFixtures: V3RegressionFixture[] =
  v3RegressionFixtures.filter((f) => f.expectations.status === 'blocked')

/**
 * The two release-gate fixtures named in the acceptance criteria. v3 must not
 * become the default generator until BOTH clear their thresholds.
 */
export const releaseGateFixtures = {
  transcript: transcriptLessonRegression,
  systems: systemsExplainerRegression,
}
