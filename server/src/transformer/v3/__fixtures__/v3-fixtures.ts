import {
  ARTICLE_JSON_V3,
  ARTICLE_V3_MODE,
  type ArticleJsonV3,
} from '../v3-contract'
import type { CoverageBlockV3 } from '../v3-coverage.util'

/**
 * Shared v3 test fixtures. Not a spec (lives under `__fixtures__/`, never matched
 * by jest's `*.spec.ts`). `makeV3Article` builds a minimal but schema-complete
 * article the gate/coverage utils can operate on; pass overrides to exercise a
 * specific gate branch.
 */
export function makeV3Article(
  overrides: Partial<ArticleJsonV3> = {},
): ArticleJsonV3 {
  return {
    schemaVersion: ARTICLE_JSON_V3,
    mode: ARTICLE_V3_MODE,
    status: 'READY_FOR_REVIEW',
    sourceKind: 'structured_web_article',
    shape: 'concept_explainer',
    title: { text: 'Title', source: 'inferred' },
    abstract: [],
    learningPath: [],
    sections: [
      {
        id: 'sec-0',
        heading: 'Section',
        sourceBlockIds: ['b1'],
        paragraphs: [
          {
            id: 'sec-0-p-0',
            text: 'Grounded paragraph.',
            sourceBlockIds: ['b1'],
            aiAssisted: false,
          },
        ],
      },
    ],
    keyConcepts: [
      {
        id: 'concept-0',
        name: 'Concept',
        normalizedName: 'concept',
        type: 'core_concept',
        shortDefinition: 'A concept.',
        sourceBlockIds: ['b1'],
        articleSectionIds: ['sec-0'],
        importance: 'high',
        suggestedCognitiveState: 'Parsed',
      },
    ],
    keyClaims: [],
    terminology: [],
    sourceExamples: [],
    misconceptionWarnings: [],
    retrievalPrompts: [
      {
        id: 'prompt-0',
        question: 'What is it?',
        expectedAnswerSourceBlockIds: ['b1'],
        relatedConceptCandidateIds: [],
        promptType: 'definition',
        difficulty: 'easy',
        status: 'ai_suggested',
      },
    ],
    calloutPlacements: { bySection: {}, unplaced: [] },
    tables: [],
    sourceNotes: [],
    references: [],
    provenance: { sourceKind: 'structured_web_article' },
    qualityReport: {
      sourceCoverageScore: 0,
      importantSourceCoverageScore: 0,
      citationCoverageScore: 0,
      unsupportedClaimCount: 0,
      highSeverityLostInfoCount: 0,
      conceptCandidateCount: 0,
      keyClaimCount: 0,
      retrievalPromptCount: 0,
      tableCount: 0,
      calloutCount: 0,
      exerciseReadinessScore: 0,
      articleReadabilityScore: 0,
      provenanceCompletenessScore: 0,
      reviewerWarnings: [],
      blockerReasons: [],
      regenerationHints: [],
    },
    ...overrides,
  }
}

/** A small block set: one important DEFINITION block + one removable nav block. */
export function makeBlocks(
  overrides: CoverageBlockV3[] = [],
): CoverageBlockV3[] {
  if (overrides.length > 0) return overrides
  return [
    { id: 'b1', classification: 'DEFINITION', removable: false },
    { id: 'b2', classification: 'NAVIGATION_NOISE', removable: true },
  ]
}
