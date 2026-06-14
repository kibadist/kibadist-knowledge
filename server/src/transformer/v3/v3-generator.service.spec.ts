import type { AiService } from '../../ai/ai.service'
import type { V3AssemblyMeta } from './v3-assembly.util'
import { isArticleJsonV3, isReadableStatusV3 } from './v3-contract'
import {
  type V3GeneratorBlock,
  V3GeneratorService,
} from './v3-generator.service'

/**
 * End-to-end generator test with a MOCKED AiService — the live-LLM path the
 * browser verifier cannot exercise without an OPENAI_API_KEY. It proves the two
 * completeJson calls + deterministic assembly produce a contract-conformant,
 * gate-passing learning article from a concept-rich source.
 */
const META: V3AssemblyMeta = {
  sourceKind: 'structured_web_article',
  shape: 'concept_explainer',
  sourceId: 'src-1',
}

const BLOCKS: V3GeneratorBlock[] = [
  {
    id: 'b1',
    blockType: 'PARAGRAPH',
    classification: 'DEFINITION',
    removable: false,
    text: 'An embedding is a dense vector representation.',
  },
  {
    id: 'b2',
    blockType: 'PARAGRAPH',
    classification: 'EXAMPLE',
    removable: false,
    text: 'word2vec maps words to vectors.',
  },
  {
    id: 'b3',
    blockType: 'PARAGRAPH',
    classification: 'NAVIGATION_NOISE',
    removable: true,
    text: 'Home About',
  },
]

const REWRITE_JSON = JSON.stringify({
  title: 'Embeddings',
  dek: 'What embeddings are.',
  abstract: [{ text: 'A short lede.', sourceBlockIds: ['b1'] }],
  sections: [
    {
      heading: 'Definition',
      sectionRole: 'definition',
      sourceBlockIds: ['b1'],
      paragraphs: [
        {
          text: 'An embedding is a dense vector representation.',
          sourceBlockIds: ['b1'],
        },
        { text: 'word2vec is one example.', sourceBlockIds: ['b2'] },
      ],
    },
  ],
})

const LEARNING_JSON = JSON.stringify({
  learningPath: [
    { label: 'Understand embeddings', sectionHeading: 'Definition' },
  ],
  // Three grounded concepts ⇒ clears the minConceptCandidateCount (3) gate for a
  // concept-rich (DEFINITION + EXAMPLE) source.
  keyConcepts: [
    {
      name: 'Embedding',
      type: 'core_concept',
      shortDefinition: 'A dense vector.',
      importance: 'high',
      sourceBlockIds: ['b1'],
    },
    {
      name: 'Dense vector',
      type: 'core_concept',
      shortDefinition: 'A vector with mostly non-zero values.',
      importance: 'medium',
      sourceBlockIds: ['b1'],
    },
    {
      name: 'word2vec',
      type: 'supporting_concept',
      shortDefinition: 'A model that maps words to vectors.',
      importance: 'medium',
      sourceBlockIds: ['b2'],
    },
  ],
  keyClaims: [
    {
      text: 'An embedding is a dense vector representation.',
      claimType: 'definition',
      confidence: 0.9,
      sourceBlockIds: ['b1'],
    },
  ],
  terminology: [
    {
      term: 'Embedding',
      definition: 'A dense vector.',
      sourceBlockIds: ['b1'],
    },
  ],
  retrievalPrompts: [
    {
      question: 'What is an embedding?',
      promptType: 'definition',
      difficulty: 'easy',
      sourceBlockIds: ['b1'],
    },
  ],
  misconceptionWarnings: [],
  sourceExamples: [{ text: 'word2vec', sourceBlockIds: ['b2'] }],
})

describe('V3GeneratorService (mocked LLM end-to-end)', () => {
  it('produces a contract-conformant, gate-passing learning article with concept candidates', async () => {
    const complete = jest
      .fn()
      .mockResolvedValueOnce({ text: REWRITE_JSON })
      .mockResolvedValueOnce({ text: LEARNING_JSON })
    const service = new V3GeneratorService({ complete } as unknown as AiService)

    const article = await service.generate(BLOCKS, META)

    expect(complete).toHaveBeenCalledTimes(2)
    expect(isArticleJsonV3(article)).toBe(true)
    // Acceptance: concept-rich source produces concept candidates.
    expect(article.keyConcepts.length).toBeGreaterThan(0)
    // Acceptance: retrieval prompts present, no unsupported claims, ready.
    expect(article.retrievalPrompts.length).toBeGreaterThan(0)
    expect(article.qualityReport.unsupportedClaimCount).toBe(0)
    expect(isReadableStatusV3(article.status)).toBe(true)
    // Learning surfaces are populated for the reader.
    expect(article.learningPath.length).toBeGreaterThan(0)
    expect(
      article.sourceNotes.some((n) => n.kind === 'removed_navigation'),
    ).toBe(true)
  })

  it('only sends substance blocks to the model (removable noise handled in assembly)', async () => {
    const complete = jest
      .fn()
      .mockResolvedValueOnce({ text: REWRITE_JSON })
      .mockResolvedValueOnce({ text: LEARNING_JSON })
    const service = new V3GeneratorService({ complete } as unknown as AiService)
    await service.generate(BLOCKS, META)
    const firstPrompt = complete.mock.calls[0][0].prompt as string
    expect(firstPrompt).toContain('[b1]')
    expect(firstPrompt).not.toContain('[b3]') // navigation noise excluded
  })
})
