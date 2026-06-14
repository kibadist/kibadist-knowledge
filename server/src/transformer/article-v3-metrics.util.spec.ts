import type { ArticleJsonV3, SourceTrace } from './article-v3.types'
import {
  collectGroundedSourceBlockIds,
  computeRegressionMetrics,
  conceptCandidateCount,
  countUnsupportedClaims,
  evaluateReleaseGate,
  findUnknownGroundedCitations,
  importantCoverage,
  knownBlockIds,
  retrievalPromptCount,
} from './article-v3-metrics.util'
import type { ClassifiedBlockInput } from './structure-model.service'

/**
 * Unit tests for the v3 regression metric + release-gate helpers (DET-361). Pure
 * functions over hand-built v3 articles — no fixtures, no LLM — so each metric's
 * contract is pinned independently of the fixture suite.
 */

const g = (ids: string[]): SourceTrace => ({
  grounded: true,
  sourceBlockIds: ids,
  transformationType: 'light_reword',
  fidelityRisk: 'low',
})

const ungrounded: SourceTrace = {
  grounded: false,
  sourceBlockIds: [],
  transformationType: 'light_reword',
  fidelityRisk: 'low',
}

/** A small but complete v3 article whose grounded ids are easy to reason about. */
function buildArticle(overrides: Partial<ArticleJsonV3> = {}): ArticleJsonV3 {
  return {
    schemaVersion: 'v3',
    mode: 'source_grounded_learning_article',
    sourceKind: 'article',
    shape: 'explainer',
    title: { text: 'T', source: 'inferred', sourceTrace: g(['b1']) },
    abstract: [{ id: 'a1', text: 'Summary.', sourceTrace: g(['b1']) }],
    learningPath: [
      {
        id: 'lp1',
        order: 0,
        title: 'Step',
        objective: 'Do.',
        conceptIds: ['kc1'],
        sourceTrace: g(['b2']),
      },
    ],
    sections: [
      {
        id: 's1',
        heading: 'H',
        headingSource: 'inferred',
        sourceTrace: g(['b1']),
        blocks: [
          { id: 'p1', type: 'paragraph', text: 'P.', sourceTrace: g(['b1']) },
          { id: 'p2', type: 'paragraph', text: 'Q.', sourceTrace: g(['b2']) },
        ],
        subsections: [
          {
            id: 's1a',
            heading: 'H2',
            headingSource: 'inferred',
            sourceTrace: g(['b3']),
            blocks: [
              {
                id: 'p3',
                type: 'paragraph',
                text: 'R.',
                sourceTrace: g(['b3']),
              },
            ],
          },
        ],
      },
    ],
    keyConcepts: [
      {
        id: 'kc1',
        label: 'C1',
        definition: 'd',
        sourceTrace: g(['b1']),
      },
      {
        id: 'kc2',
        label: 'C2',
        definition: 'd',
        sourceTrace: g(['b2']),
      },
    ],
    keyClaims: [{ id: 'cl1', statement: 'A claim.', sourceTrace: g(['b1']) }],
    terminology: [],
    sourceExamples: [],
    misconceptionWarnings: [],
    retrievalPrompts: [
      { id: 'rp1', prompt: 'Q?', sourceTrace: ungrounded },
      { id: 'rp2', prompt: 'Q2?', answer: 'A.', sourceTrace: g(['b2']) },
    ],
    calloutPlacements: { bySection: {}, unplaced: [] },
    tables: [],
    sourceNotes: [],
    references: [],
    provenance: {
      sourceKind: 'article',
      generationMode: 'source_grounded_learning_article',
      pipelineVersion: 1,
    },
    qualityReport: {
      groundingScore: 1,
      coverageScore: 1,
      conceptCoverageScore: 1,
      approved: true,
      issues: [],
    },
    ...overrides,
  }
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'one',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'two',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'three',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'noise',
    removable: true,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'five',
    removable: false,
  },
]

describe('collectGroundedSourceBlockIds', () => {
  it('gathers grounded ids from every surface and ignores ungrounded traces', () => {
    const ids = collectGroundedSourceBlockIds(buildArticle())
    expect([...ids].sort()).toEqual(['b1', 'b2', 'b3'])
  })
})

describe('findUnknownGroundedCitations', () => {
  it('returns nothing when every grounded id is known', () => {
    const known = knownBlockIds(blocks)
    expect(findUnknownGroundedCitations(buildArticle(), known)).toEqual([])
  })

  it('flags a grounded citation to a block the source lacks', () => {
    const article = buildArticle({
      keyClaims: [{ id: 'cl1', statement: 'x', sourceTrace: g(['ghost']) }],
    })
    const known = knownBlockIds(blocks)
    expect(findUnknownGroundedCitations(article, known)).toEqual(['ghost'])
  })
})

describe('counts', () => {
  it('conceptCandidateCount and retrievalPromptCount read the arrays', () => {
    const a = buildArticle()
    expect(conceptCandidateCount(a)).toBe(2)
    expect(retrievalPromptCount(a)).toBe(2)
  })
})

describe('countUnsupportedClaims', () => {
  const known = knownBlockIds(blocks)

  it('is 0 when every claim is grounded in a known block', () => {
    expect(countUnsupportedClaims(buildArticle(), known)).toBe(0)
  })

  it('counts an ungrounded claim', () => {
    const a = buildArticle({
      keyClaims: [{ id: 'cl1', statement: 'x', sourceTrace: ungrounded }],
    })
    expect(countUnsupportedClaims(a, known)).toBe(1)
  })

  it('counts a grounded claim citing an unknown block', () => {
    const a = buildArticle({
      keyClaims: [{ id: 'cl1', statement: 'x', sourceTrace: g(['ghost']) }],
    })
    expect(countUnsupportedClaims(a, known)).toBe(1)
  })
})

describe('importantCoverage', () => {
  it('is the fraction of non-removable blocks represented by a grounded citation', () => {
    // Important blocks: b1,b2,b3,b5. Grounded ids in the article: b1,b2,b3 → 3/4.
    expect(importantCoverage(buildArticle(), blocks)).toBeCloseTo(0.75)
  })

  it('ignores removable (noise) blocks', () => {
    // b4 is removable, so leaving it uncited does not lower coverage.
    const onlyNoiseUncited: ClassifiedBlockInput[] = blocks.filter(
      (b) => b.id !== 'b5',
    )
    expect(importantCoverage(buildArticle(), onlyNoiseUncited)).toBeCloseTo(1)
  })

  it('is 1 when there are no important blocks', () => {
    const allNoise: ClassifiedBlockInput[] = [
      {
        id: 'z',
        type: 'PARAGRAPH',
        classification: 'NOISE',
        text: 'n',
        removable: true,
      },
    ]
    expect(importantCoverage(buildArticle(), allNoise)).toBe(1)
  })
})

describe('computeRegressionMetrics', () => {
  it('assembles the full metric set', () => {
    const m = computeRegressionMetrics(buildArticle(), blocks)
    expect(m).toMatchObject({
      conceptCandidateCount: 2,
      retrievalPromptCount: 2,
      unsupportedClaimCount: 0,
      unknownGroundedCitations: [],
      importantBlockCount: 4,
      coveredImportantBlockCount: 3,
      status: 'ready',
    })
    expect(m.importantCoverage).toBeCloseTo(0.75)
  })

  it('reports blocked status from a non-approving quality report', () => {
    const a = buildArticle({
      qualityReport: {
        groundingScore: 0.5,
        coverageScore: 0.5,
        conceptCoverageScore: 0.5,
        approved: false,
        issues: [],
      },
    })
    expect(computeRegressionMetrics(a, blocks).status).toBe('blocked')
  })
})

describe('evaluateReleaseGate', () => {
  const thresholds = {
    minImportantCoverage: 0.7,
    minConceptCandidates: 2,
    minRetrievalPrompts: 2,
    maxUnsupportedClaims: 0,
  }

  it('passes a healthy article', () => {
    const result = evaluateReleaseGate(buildArticle(), blocks, thresholds)
    expect(result.passed).toBe(true)
    expect(result.failures).toEqual([])
  })

  it('fails and names each missed threshold', () => {
    const weak = buildArticle({
      keyConcepts: [],
      retrievalPrompts: [],
      keyClaims: [{ id: 'cl1', statement: 'x', sourceTrace: g(['ghost']) }],
      qualityReport: {
        groundingScore: 0.2,
        coverageScore: 0.2,
        conceptCoverageScore: 0.2,
        approved: false,
        issues: [],
      },
    })
    const result = evaluateReleaseGate(weak, blocks, thresholds)
    expect(result.passed).toBe(false)
    expect(result.failures.some((m) => /status/.test(m))).toBe(true)
    expect(result.failures.some((m) => /conceptCandidateCount/.test(m))).toBe(
      true,
    )
    expect(result.failures.some((m) => /retrievalPromptCount/.test(m))).toBe(
      true,
    )
    expect(result.failures.some((m) => /unsupportedClaimCount/.test(m))).toBe(
      true,
    )
    expect(result.failures.some((m) => /untraceable/.test(m))).toBe(true)
  })
})
