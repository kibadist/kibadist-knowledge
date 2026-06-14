import type {
  ArticleJsonV2,
  FidelityReport,
  LearningLayer,
  TransformerBlockView,
} from '@/lib/api'

/**
 * Two in-repo fixtures for the provenance UI (DET-358 acceptance: "works for
 * both transcript and structured article fixtures"). No network — these mirror
 * the wire `TransformedArticle` pieces the `/read` workspace fetches.
 *
 *  - `transcriptFixture`: a messy spoken-transcript source → a reshaped article
 *    with a heavier reword (medium/high fidelity risk) and one paragraph whose
 *    source link is BROKEN (a hallucinated block id) to exercise the unsupported
 *    fallback.
 *  - `structuredFixture`: a clean headinged document → a faithful, low-risk
 *    article with concepts, a candidate, a retrieval prompt and a claim.
 */

function block(
  over: Partial<TransformerBlockView> & Pick<TransformerBlockView, 'id'>,
): TransformerBlockView {
  return {
    orderIndex: 0,
    blockType: 'PARAGRAPH',
    text: 'Source text.',
    pageNumber: null,
    charStart: null,
    charEnd: null,
    classification: null,
    classificationStatus: 'CLASSIFIED',
    removable: false,
    noiseReason: null,
    ...over,
  }
}

// --- Transcript fixture ------------------------------------------------------

export const transcriptBlocks: TransformerBlockView[] = [
  block({
    id: 't-b0',
    orderIndex: 0,
    text: 'so um yeah the the mitochondria is basically the powerhouse you know',
    classification: 'MAIN_ARGUMENT',
    pageNumber: null,
    charStart: 0,
    charEnd: 64,
  }),
  block({
    id: 't-b1',
    orderIndex: 1,
    text: "and like it makes ATP which is the energy currency, that's the key thing",
    classification: 'DEFINITION',
    charStart: 65,
    charEnd: 138,
  }),
  block({
    id: 't-b2',
    orderIndex: 2,
    text: 'but caveat, not every cell has the same number of them, depends',
    classification: 'EVIDENCE',
    charStart: 139,
    charEnd: 202,
  }),
]

export const transcriptArticle: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'The Mitochondrion', source: 'inferred' },
  abstract: [
    {
      id: 't-abs-0',
      text: 'The mitochondrion is the cell’s power plant.',
      sourceBlockIds: ['t-b0'],
      transformationType: 'light_reword',
      fidelityRisk: 'medium',
    },
  ],
  sections: [
    {
      id: 't-sec-1',
      heading: 'Energy',
      headingSource: 'inferred',
      sourceBlockIds: ['t-b1', 't-b2'],
      blocks: [
        {
          id: 't-p1',
          type: 'paragraph',
          text: 'It produces ATP, the cell’s energy currency.',
          sourceBlockIds: ['t-b1'],
          transformationType: 'light_reword',
          fidelityRisk: 'low',
        },
        {
          // A hallucinated source id — exercises the unsupported fallback.
          id: 't-p2',
          type: 'paragraph',
          text: 'Mitochondria multiply without limit in every cell.',
          sourceBlockIds: ['t-ghost'],
          transformationType: 'light_reword',
          fidelityRisk: 'high',
        },
        {
          id: 't-callout-1',
          type: 'callout',
          calloutType: 'warning',
          title: 'Caveat',
          text: 'The count of mitochondria varies by cell type.',
          sourceBlockIds: ['t-b2'],
          transformationType: 'light_reword',
          fidelityRisk: 'medium',
        },
      ],
    },
  ],
  keyTerms: [{ term: 'ATP', sourceBlockIds: ['t-b1'] }],
  sourceExamples: [],
  caveats: [{ text: 'Counts vary by cell type.', sourceBlockIds: ['t-b2'] }],
  originalStructure: [],
  readingAids: {
    toc: [
      { sectionId: 't-sec-1', heading: 'Energy', headingSource: 'inferred' },
    ],
    readingTime: { wordCount: 40, minutes: 1 },
    highlights: [
      {
        text: 'ATP is the energy currency of the cell.',
        sourceBlockIds: ['t-b1'],
      },
    ],
  },
}

export const transcriptFidelity: FidelityReport = {
  fidelityScore: 0.72,
  approved: false,
  addedInformation: [
    {
      severity: 'high',
      description:
        'The claim that mitochondria “multiply without limit” is not in the source.',
      articleRef: 't-p2',
      sourceBlockIds: [],
    },
  ],
  lostInformation: [],
  meaningChanges: [
    {
      severity: 'medium',
      description: 'The hedging in the source caveat was softened.',
      articleRef: 't-callout-1',
      sourceBlockIds: ['t-b2'],
    },
  ],
  unsupportedHeadings: [],
  missingCaveats: [],
  unsupportedExamples: [],
  emphasisChanges: [],
  structuralFindings: [],
}

export const transcriptLearning: LearningLayer = {
  concepts: [
    {
      id: 't-concept-1',
      label: 'ATP',
      definition: 'The energy currency molecule of the cell.',
      sourceBlockIds: ['t-b1'],
      validationStatus: 'pending',
    },
  ],
  retrievalPrompts: [
    {
      id: 't-prompt-1',
      prompt: 'What molecule do mitochondria produce, and what is its role?',
      sourceBlockIds: ['t-b1'],
    },
  ],
  conceptCandidates: [
    {
      id: 't-cand-1',
      sectionId: 't-sec-1',
      label: 'Energy currency',
      definition: 'A molecule cells spend to do work.',
      sourceBlockIds: ['t-b1'],
      aiAssisted: true,
      validationStatus: 'pending',
    },
  ],
}

export const transcriptFixture = {
  article: transcriptArticle,
  blocks: transcriptBlocks,
  fidelityReport: transcriptFidelity,
  learningLayer: transcriptLearning,
}

// --- Structured-document fixture ---------------------------------------------

export const structuredBlocks: TransformerBlockView[] = [
  block({
    id: 's-h0',
    orderIndex: 0,
    blockType: 'HEADING',
    text: 'Photosynthesis',
    classification: 'BACKGROUND',
    pageNumber: 1,
  }),
  block({
    id: 's-b1',
    orderIndex: 1,
    text: 'Photosynthesis converts light energy into chemical energy.',
    classification: 'DEFINITION',
    pageNumber: 1,
  }),
  block({
    id: 's-b2',
    orderIndex: 2,
    text: 'It occurs in the chloroplasts of plant cells.',
    classification: 'EVIDENCE',
    pageNumber: 1,
  }),
]

export const structuredArticle: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Photosynthesis', source: 'original' },
  abstract: [
    {
      id: 's-abs-0',
      text: 'Photosynthesis converts light energy into chemical energy.',
      sourceBlockIds: ['s-b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's-sec-1',
      heading: 'Where it happens',
      headingSource: 'original',
      headingSourceBlockIds: ['s-h0'],
      sourceBlockIds: ['s-b2'],
      blocks: [
        {
          id: 's-p1',
          type: 'paragraph',
          text: 'It occurs in the chloroplasts of plant cells.',
          sourceBlockIds: ['s-b2'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
        {
          id: 's-table-1',
          type: 'table',
          caption: 'Inputs and outputs',
          header: ['Input', 'Output'],
          rows: [['Light', 'Glucose']],
          sourceBlockIds: ['s-b1', 's-b2'],
          transformationType: 'formatting_only',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [{ term: 'Chloroplast', sourceBlockIds: ['s-b2'] }],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
  readingAids: {
    toc: [
      {
        sectionId: 's-sec-1',
        heading: 'Where it happens',
        headingSource: 'original',
      },
    ],
    readingTime: { wordCount: 30, minutes: 1 },
    highlights: [
      {
        text: 'Photosynthesis converts light energy into chemical energy.',
        sourceBlockIds: ['s-b1'],
      },
    ],
  },
}

export const structuredLearning: LearningLayer = {
  concepts: [
    {
      id: 's-concept-1',
      label: 'Chloroplast',
      definition: 'The organelle where photosynthesis occurs.',
      sourceBlockIds: ['s-b2'],
      validationStatus: 'validated',
    },
  ],
  retrievalPrompts: [
    {
      id: 's-prompt-1',
      prompt: 'Where in the cell does photosynthesis take place?',
      sourceBlockIds: ['s-b2'],
    },
  ],
  conceptCandidates: [],
}

export const structuredFixture = {
  article: structuredArticle,
  blocks: structuredBlocks,
  fidelityReport: null,
  learningLayer: structuredLearning,
}
