import {
  type AssemblyBlockV3,
  assembleArticleV3,
  type V3AssemblyMeta,
} from './v3-assembly.util'
import { isArticleJsonV3 } from './v3-contract'
import type { V3LearningLlm, V3RewriteLlm } from './v3-llm.schema'

const META: V3AssemblyMeta = {
  sourceKind: 'structured_web_article',
  shape: 'concept_explainer',
  sourceId: 'src-1',
  sourceUrl: 'https://example.com',
  captureMethod: 'URL',
}

const BLOCKS: AssemblyBlockV3[] = [
  {
    id: 'b1',
    blockType: 'HEADING',
    classification: 'DEFINITION',
    removable: false,
    text: 'Embeddings',
  },
  {
    id: 'b2',
    blockType: 'PARAGRAPH',
    classification: 'DEFINITION',
    removable: false,
    text: 'An embedding is a dense vector.',
  },
  {
    id: 'b3',
    blockType: 'PARAGRAPH',
    classification: 'EXAMPLE',
    removable: false,
    text: 'For example word2vec.',
  },
  {
    id: 'b4',
    blockType: 'PARAGRAPH',
    classification: 'CITATION',
    removable: true,
    text: 'Mikolov et al. 2013',
  },
  {
    id: 'b5',
    blockType: 'PARAGRAPH',
    classification: 'NAVIGATION_NOISE',
    removable: true,
    text: 'Home About Contact',
  },
]

const REWRITE: V3RewriteLlm = {
  title: 'Embeddings',
  dek: 'What embeddings are and why they matter.',
  abstract: [{ text: 'A short lede.', sourceBlockIds: ['b2'] }],
  sections: [
    {
      heading: 'Definition',
      sectionRole: 'definition',
      targetReaderOutcome: 'Explain what an embedding is',
      sourceBlockIds: ['b2'],
      paragraphs: [
        { text: 'An embedding is a dense vector.', sourceBlockIds: ['b2'] },
        { text: 'This framing helps you reason about it.', sourceBlockIds: [] },
      ],
    },
  ],
}

const LEARNING: V3LearningLlm = {
  learningPath: [
    { label: 'Understand embeddings', sectionHeading: 'Definition' },
  ],
  keyConcepts: [
    {
      name: 'Embedding',
      type: 'core_concept',
      shortDefinition: 'A dense vector.',
      importance: 'high',
      sourceBlockIds: ['b2'],
    },
  ],
  keyClaims: [
    {
      text: 'An embedding is a dense vector.',
      claimType: 'definition',
      confidence: 0.9,
      sourceBlockIds: ['b2'],
    },
    {
      text: 'Embeddings always beat sparse features.',
      claimType: 'causal_claim',
      confidence: 0.4,
      sourceBlockIds: ['nonexistent'],
    },
  ],
  terminology: [
    {
      term: 'Embedding',
      definition: 'A dense vector.',
      sourceBlockIds: ['b2'],
    },
  ],
  retrievalPrompts: [
    {
      question: 'What is an embedding?',
      promptType: 'definition',
      difficulty: 'easy',
      relatedConceptNames: ['Embedding'],
      sourceBlockIds: ['b2'],
    },
  ],
  misconceptionWarnings: [],
  sourceExamples: [{ text: 'word2vec', sourceBlockIds: ['b3'] }],
}

describe('v3 assembly (DET-343)', () => {
  const article = assembleArticleV3(REWRITE, LEARNING, BLOCKS, META)

  it('produces a contract-conformant v3 learning article (schemaVersion + mode)', () => {
    expect(isArticleJsonV3(article)).toBe(true)
    expect(article.mode).toBe('source_grounded_learning_article')
    expect(article.sourceKind).toBe('structured_web_article')
    expect(article.shape).toBe('concept_explainer')
  })

  it('mints deterministic ids and renders sections as paragraphs (reader shape)', () => {
    expect(article.sections[0].id).toBe('sec-0')
    expect(article.sections[0].paragraphs[0].id).toBe('sec-0-p-0')
    expect(article.keyConcepts[0].id).toBe('concept-0')
    expect(article.keyConcepts[0].name).toBe('Embedding')
    expect(article.keyConcepts[0].normalizedName).toBe('embedding')
  })

  it('marks ungrounded prose as AI scaffolding and grounded prose as source', () => {
    const [grounded, scaffold] = article.sections[0].paragraphs
    expect(grounded.sourceBlockIds).toEqual(['b2'])
    expect(grounded.aiAssisted).toBe(false)
    expect(scaffold.sourceBlockIds).toEqual([])
    expect(scaffold.aiAssisted).toBe(true)
  })

  it('drops citations to non-existent blocks; an ungrounded claim survives as the unsupported signal', () => {
    const unsupported = article.keyClaims.find(
      (c) => c.sourceBlockIds.length === 0,
    )
    expect(unsupported?.text).toContain('always beat sparse')
    expect(article.qualityReport.unsupportedClaimCount).toBe(1)
    expect(article.status).toBe('BLOCKED_UNSUPPORTED_CLAIMS')
  })

  it('moves references/navigation OUT of the body into source notes', () => {
    expect(article.references.map((r) => r.label)).toContain(
      'Mikolov et al. 2013',
    )
    expect(article.sourceNotes.some((n) => n.kind === 'reference')).toBe(true)
    expect(
      article.sourceNotes.some((n) => n.kind === 'removed_navigation'),
    ).toBe(true)
  })

  it('cross-references concepts to prompts and sections by source overlap', () => {
    expect(article.retrievalPrompts[0].relatedConceptCandidateIds).toEqual([
      'concept-0',
    ])
    expect(article.keyConcepts[0].articleSectionIds).toContain('sec-0')
    expect(article.learningPath[0].sectionId).toBe('sec-0')
  })

  it('stamps provenance counts and a reading time', () => {
    expect(article.provenance.totalSourceBlocks).toBe(5)
    expect(article.provenance.representedSourceBlocks).toBeGreaterThan(0)
    expect(article.readingTimeMinutes).toBeGreaterThanOrEqual(1)
  })
})
