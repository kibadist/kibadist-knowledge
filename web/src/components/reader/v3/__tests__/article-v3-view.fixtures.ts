import type { ArticleJsonV3 } from '@/lib/article-v3'

/**
 * Reader fixtures for the Article JSON v3 renderer tests (DET-357). No network:
 * these are in-repo, deterministic article shapes the snapshot tests render
 * against. Two canonical shapes are covered, mirroring the pipeline's headline
 * cases (DET-345/348): a transcript → `lesson_article` and a structured web
 * article → `concept_explainer`, plus a blocked variant of the explainer.
 */

/** A v3 lesson article — transcript_lesson → lesson_article, READY_FOR_REVIEW. */
export const lessonArticleV3: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  status: 'READY_FOR_REVIEW',
  sourceKind: 'transcript_lesson',
  shape: 'lesson_article',
  title: { text: 'How a Transformer Block Works', source: 'inferred' },
  dek: 'The instructor walks through attention, the MLP, and why non-linearity matters.',
  readingTimeMinutes: 7,
  generatedAt: '2026-06-13T00:00:00.000Z',
  abstract: [
    {
      id: 'ab1',
      text: 'A transformer block routes information with attention, then transforms it with a small feed-forward network.',
      sourceBlockIds: ['b1'],
      transformationType: 'source_grounded_summary',
      fidelityRisk: 'low',
    },
  ],
  learningPath: [
    {
      id: 'lp1',
      label: 'How attention routes information',
      sectionId: 's-attention',
      outcome: 'Explain query, key, and value in your own words.',
    },
    {
      id: 'lp2',
      label: 'Why the MLP needs a non-linearity',
      sectionId: 's-mlp',
    },
  ],
  sections: [
    {
      id: 's-attention',
      heading: 'Attention routes information',
      sectionRole: 'mechanism',
      conceptFocus: ['attention', 'query/key/value'],
      targetReaderOutcome: 'You can describe what Q, K, and V each do.',
      sourceBlockIds: ['b2', 'b3'],
      paragraphs: [
        {
          id: 'p1',
          text: 'Each token emits a query, a key, and a value; attention compares queries to keys to decide how much of each value to mix in.',
          sourceBlockIds: ['b2'],
          transformationType: 'source_grounded_rewrite',
          fidelityRisk: 'low',
        },
        {
          id: 'p2',
          text: 'Think of it as a soft lookup table the model learns end to end.',
          sourceBlockIds: [],
          aiAssisted: true,
        },
      ],
    },
    {
      id: 's-mlp',
      heading: 'The MLP transforms each token',
      sectionRole: 'mechanism',
      sourceBlockIds: ['b4'],
      paragraphs: [
        {
          id: 'p3',
          text: 'The MLP expands the representation, applies a non-linearity, then projects it back down.',
          sourceBlockIds: ['b4'],
          transformationType: 'source_grounded_rewrite',
          fidelityRisk: 'low',
        },
      ],
      subsections: [
        {
          id: 's-mlp-nonlin',
          heading: 'Why a non-linearity?',
          sectionRole: 'definition',
          sourceBlockIds: ['b5'],
          paragraphs: [
            {
              id: 'p4',
              text: 'Without a non-linearity, stacking layers collapses to a single linear map.',
              sourceBlockIds: ['b5'],
              transformationType: 'source_grounded_rewrite',
              fidelityRisk: 'low',
            },
          ],
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'c1',
      name: 'Attention',
      normalizedName: 'attention',
      type: 'core_concept',
      shortDefinition:
        'A mechanism that mixes token values weighted by query–key similarity.',
      sourceBlockIds: ['b2'],
      articleSectionIds: ['s-attention'],
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      status: 'ai_suggested',
    },
    {
      id: 'c2',
      name: 'Multi-layer perceptron',
      normalizedName: 'mlp',
      type: 'supporting_concept',
      shortDefinition:
        'A per-token feed-forward network: expand, non-linearity, project down.',
      sourceBlockIds: ['b4'],
      articleSectionIds: ['s-mlp'],
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      status: 'ai_suggested',
    },
  ],
  keyClaims: [
    {
      id: 'cl1',
      text: 'Attention decides how much of each value to mix using query–key similarity.',
      sourceBlockIds: ['b2'],
      articleSectionIds: ['s-attention'],
      claimType: 'mechanism',
      confidence: 0.9,
    },
  ],
  terminology: [
    {
      id: 't1',
      term: 'Non-linearity',
      definition:
        'A function that breaks linearity so stacked layers can express more.',
      sourceBlockIds: ['b5'],
    },
  ],
  sourceExamples: [
    {
      id: 'ex1',
      text: 'The instructor compares attention to an audio mixer balancing tracks.',
      sourceBlockIds: ['b6'],
      relatedSectionIds: ['s-attention'],
    },
  ],
  misconceptionWarnings: [
    {
      id: 'm1',
      misconception: 'Attention "looks at" tokens one at a time.',
      correction: 'Attention computes all pairwise interactions in parallel.',
      sourceBlockIds: ['b2'],
      relatedConceptCandidateIds: ['c1'],
      confidence: 0.8,
      status: 'ai_suggested',
    },
  ],
  retrievalPrompts: [
    {
      id: 'rp1',
      question:
        'What do the query, key, and value vectors each represent in attention?',
      expectedAnswerSourceBlockIds: ['b2'],
      relatedConceptCandidateIds: ['c1'],
      promptType: 'mechanism',
      difficulty: 'medium',
      status: 'ai_suggested',
    },
    {
      id: 'rp2',
      question: 'Why does the MLP need a non-linearity?',
      expectedAnswerSourceBlockIds: ['b5'],
      relatedConceptCandidateIds: ['c2'],
      promptType: 'definition',
      difficulty: 'easy',
      status: 'ai_suggested',
    },
  ],
  calloutPlacements: {
    bySection: {
      's-attention': [
        {
          id: 'co1',
          type: 'source_analogy',
          title: 'Attention as a mixer',
          body: 'The instructor likens attention to an audio mixer blending tracks.',
          sourceBlockIds: ['b6'],
          relatedSectionIds: ['s-attention'],
          fidelityRisk: 'low',
        },
      ],
    },
    unplaced: [],
  },
  tables: [
    {
      id: 'tbl1',
      title: 'Stages of the MLP',
      columns: ['Stage', 'Operation'],
      rows: [
        ['Expand', 'Project up to a wider hidden size'],
        ['Activate', 'Apply the non-linearity'],
        ['Project', 'Project back down to the model size'],
      ],
      sourceBlockIds: ['b4'],
      relatedSectionIds: ['s-mlp'],
      fidelityRisk: 'low',
    },
  ],
  sourceNotes: [
    {
      id: 'sn1',
      kind: 'low_importance',
      text: 'Instructor housekeeping about the course schedule was dropped.',
    },
  ],
  references: [
    {
      id: 'ref1',
      label: 'Attention Is All You Need (Vaswani et al., 2017)',
      url: 'https://arxiv.org/abs/1706.03762',
    },
  ],
  provenance: {
    sourceId: 'src-1',
    sourceUrl: 'https://www.youtube.com/watch?v=example',
    sourceKind: 'transcript_lesson',
    captureMethod: 'URL',
    capturedAt: '2026-06-12T00:00:00.000Z',
    totalSourceBlocks: 12,
    representedSourceBlocks: 11,
    sourceAvailable: true,
  },
  qualityReport: {
    sourceCoverageScore: 0.92,
    importantSourceCoverageScore: 0.88,
    citationCoverageScore: 0.95,
    unsupportedClaimCount: 0,
    highSeverityLostInfoCount: 0,
    conceptCandidateCount: 2,
    keyClaimCount: 1,
    retrievalPromptCount: 2,
    tableCount: 1,
    calloutCount: 1,
    exerciseReadinessScore: 0.82,
    articleReadabilityScore: 0.9,
    provenanceCompletenessScore: 0.97,
    reviewerWarnings: [],
    blockerReasons: [],
    regenerationHints: [],
  },
}

/** A v3 concept explainer — structured_web_article → concept_explainer, FINAL. */
export const conceptExplainerV3: ArticleJsonV3 = {
  schemaVersion: 'v3',
  mode: 'source_grounded_learning_article',
  status: 'FINAL',
  sourceKind: 'structured_web_article',
  shape: 'concept_explainer',
  title: {
    text: 'Systems, Boundaries, and the Environment',
    source: 'cleanedOriginal',
  },
  dek: 'What a system is, where its boundary lies, and how open and closed systems differ.',
  readingTimeMinutes: 6,
  abstract: [
    {
      id: 'ab1',
      text: 'A system is a set of interacting parts considered as a whole, separated from its environment by a boundary.',
      sourceBlockIds: ['s1'],
      transformationType: 'source_grounded_summary',
      fidelityRisk: 'low',
    },
  ],
  learningPath: [
    { id: 'lp1', label: 'What a system is', sectionId: 'sec-def' },
    {
      id: 'lp2',
      label: 'Open, closed, and isolated systems',
      sectionId: 'sec-types',
    },
  ],
  sections: [
    {
      id: 'sec-def',
      heading: 'What is a system?',
      sectionRole: 'definition',
      sourceBlockIds: ['s1', 's2'],
      paragraphs: [
        {
          id: 'p1',
          text: 'A system is a group of interacting or interdependent elements forming a unified whole.',
          sourceBlockIds: ['s1'],
          transformationType: 'source_grounded_rewrite',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 'sec-types',
      heading: 'Open, closed, and isolated systems',
      sectionRole: 'types',
      sourceBlockIds: ['s3'],
      paragraphs: [
        {
          id: 'p2',
          text: 'Systems are classified by what crosses their boundary: matter, energy, both, or neither.',
          sourceBlockIds: ['s3'],
          transformationType: 'source_grounded_rewrite',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyConcepts: [
    {
      id: 'c1',
      name: 'System',
      normalizedName: 'system',
      type: 'core_concept',
      shortDefinition: 'A set of interacting parts considered as a whole.',
      sourceBlockIds: ['s1'],
      articleSectionIds: ['sec-def'],
      importance: 'high',
      suggestedCognitiveState: 'Parsed',
      status: 'ai_suggested',
      relationshipCandidates: [
        { type: 'contrasts_with', targetName: 'Environment' },
      ],
    },
    {
      id: 'c2',
      name: 'Boundary',
      normalizedName: 'boundary',
      type: 'supporting_concept',
      shortDefinition:
        'The interface separating a system from its environment.',
      sourceBlockIds: ['s2'],
      articleSectionIds: ['sec-def'],
      importance: 'medium',
      suggestedCognitiveState: 'Seen',
      status: 'ai_suggested',
    },
  ],
  keyClaims: [
    {
      id: 'cl1',
      text: 'A system is separated from its environment by a boundary.',
      sourceBlockIds: ['s2'],
      articleSectionIds: ['sec-def'],
      claimType: 'definition',
      confidence: 0.92,
    },
  ],
  terminology: [
    {
      id: 't1',
      term: 'Environment',
      definition: 'Everything outside the system boundary that can affect it.',
      sourceBlockIds: ['s2'],
    },
  ],
  sourceExamples: [],
  misconceptionWarnings: [],
  retrievalPrompts: [
    {
      id: 'rp1',
      question: 'What distinguishes an open system from a closed system?',
      expectedAnswerSourceBlockIds: ['s3'],
      relatedConceptCandidateIds: ['c1'],
      promptType: 'distinction',
      difficulty: 'medium',
      status: 'ai_suggested',
    },
  ],
  calloutPlacements: {
    bySection: {
      'sec-def': [
        {
          id: 'co1',
          type: 'definition',
          title: 'System',
          body: 'A set of interacting parts considered as a whole.',
          sourceBlockIds: ['s1'],
          relatedSectionIds: ['sec-def'],
          fidelityRisk: 'low',
        },
      ],
    },
    unplaced: [
      {
        id: 'co2',
        type: 'remember',
        body: 'The boundary is a modelling choice, not always a physical wall.',
        sourceBlockIds: ['s2'],
        fidelityRisk: 'medium',
      },
    ],
  },
  tables: [
    {
      id: 'tbl1',
      title: 'Open vs closed vs isolated',
      columns: ['Type', 'Matter', 'Energy'],
      rows: [
        ['Open', 'Crosses', 'Crosses'],
        ['Closed', 'Does not cross', 'Crosses'],
        ['Isolated', 'Does not cross', 'Does not cross'],
      ],
      sourceBlockIds: ['s3'],
      relatedSectionIds: ['sec-types'],
      fidelityRisk: 'low',
    },
  ],
  sourceNotes: [
    {
      id: 'sn1',
      kind: 'removed_navigation',
      text: 'Wikipedia sidebar and category navigation were removed.',
    },
  ],
  references: [
    {
      id: 'ref1',
      label: 'Systems theory — Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Systems_theory',
    },
    {
      id: 'ref2',
      label: 'von Bertalanffy, General System Theory (1968)',
    },
  ],
  provenance: {
    sourceId: 'src-2',
    sourceUrl: 'https://en.wikipedia.org/wiki/System',
    sourceKind: 'structured_web_article',
    captureMethod: 'URL',
    totalSourceBlocks: 20,
    representedSourceBlocks: 15,
    sourceAvailable: true,
  },
  qualityReport: {
    sourceCoverageScore: 0.75,
    importantSourceCoverageScore: 0.78,
    citationCoverageScore: 0.9,
    unsupportedClaimCount: 0,
    highSeverityLostInfoCount: 0,
    conceptCandidateCount: 2,
    keyClaimCount: 1,
    retrievalPromptCount: 1,
    tableCount: 1,
    calloutCount: 2,
    exerciseReadinessScore: 0.74,
    articleReadabilityScore: 0.88,
    provenanceCompletenessScore: 0.85,
    reviewerWarnings: ['One section relies on a single source block.'],
    blockerReasons: [],
    regenerationHints: [],
  },
}

/** A blocked concept explainer — held back by low important-source coverage. */
export const blockedArticleV3: ArticleJsonV3 = {
  ...conceptExplainerV3,
  status: 'BLOCKED_LOW_COVERAGE',
  qualityReport: {
    ...conceptExplainerV3.qualityReport,
    importantSourceCoverageScore: 0.41,
    exerciseReadinessScore: 0.5,
    reviewerWarnings: [
      'Half of the high-importance source blocks are unrepresented.',
    ],
    blockerReasons: [
      {
        code: 'low_coverage',
        message:
          'Only 41% of high-importance source blocks are represented (needs 70%).',
        qualityReportRef: 'importantSourceCoverageScore',
        sourceBlockIds: ['s4', 's5'],
      },
    ],
    regenerationHints: [
      'Add sections covering the unrepresented high-importance blocks s4 and s5.',
      'Re-run the outline stage with the missing segments merged in.',
    ],
  },
}
