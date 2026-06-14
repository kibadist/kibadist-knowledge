import {
  buildArticleQualityReport,
  type FidelityReviewInput,
  importantBlockIds,
  isBlockedByReview,
  type ReviewBlock,
} from './fidelity-review.util'
import type { SourceStructureModel } from './schemas'
import { ArticleQualityReportV3Schema } from './schemas'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleSectionV2,
  CoverageReport,
  FidelityReport,
} from './transformer.types'

// --- builders --------------------------------------------------------------

function sm(partial: Partial<SourceStructureModel> = {}): SourceStructureModel {
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

function coverage(partial: Partial<CoverageReport> = {}): CoverageReport {
  return {
    totalBlocks: 0,
    coveragePercent: 100,
    representedBlockIds: [],
    removedBlocks: [],
    uncertainBlockIds: [],
    unrepresentedBlockIds: [],
    paragraphMap: [],
    ...partial,
  }
}

function fidelity(partial: Partial<FidelityReport> = {}): FidelityReport {
  return {
    fidelityScore: 98,
    approved: true,
    addedInformation: [],
    lostInformation: [],
    meaningChanges: [],
    unsupportedHeadings: [],
    missingCaveats: [],
    unsupportedExamples: [],
    emphasisChanges: [],
    structuralFindings: [],
    ...partial,
  }
}

function para(
  id: string,
  sourceBlockIds: string[],
  text = 'lorem ipsum',
): ArticleBlock {
  return {
    id,
    type: 'paragraph',
    text,
    sourceBlockIds,
    transformationType: 'verbatim',
    fidelityRisk: 'low',
  }
}

function section(
  id: string,
  blocks: ArticleBlock[],
  sourceBlockIds: string[],
): ArticleSectionV2 {
  return {
    id,
    heading: `Section ${id}`,
    headingSource: 'original',
    sourceBlockIds,
    blocks,
  }
}

function article(partial: Partial<ArticleJsonV2> = {}): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [
      {
        id: 'p1',
        text: 'abstract',
        sourceBlockIds: ['b1'],
        transformationType: 'verbatim',
        fidelityRisk: 'low',
      },
    ],
    sections: [section('s1', [para('sp1', ['b1'])], ['b1'])],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    ...partial,
  }
}

function input(
  partial: Partial<FidelityReviewInput> = {},
): FidelityReviewInput {
  return {
    article: article(),
    structureModel: sm(),
    blocks: [{ id: 'b1', classification: 'MAIN_ARGUMENT', removable: false }],
    fidelityReport: fidelity(),
    coverageReport: coverage({
      totalBlocks: 1,
      coveragePercent: 100,
      representedBlockIds: ['b1'],
    }),
    learningLayer: { concepts: [], retrievalPrompts: [] },
    ...partial,
  }
}

// --- tests -----------------------------------------------------------------

describe('importantBlockIds', () => {
  it('unions structure-model citations with high-value classifications, drops removable', () => {
    const blocks: ReviewBlock[] = [
      { id: 'b1', classification: 'MAIN_ARGUMENT', removable: false },
      { id: 'b2', classification: 'BACKGROUND', removable: false }, // cited as a claim
      { id: 'b3', classification: 'DEFINITION', removable: false },
      { id: 'b4', classification: 'EVIDENCE', removable: true }, // removable → excluded
    ]
    const ids = importantBlockIds(
      sm({ claims: [{ text: 'c', sourceBlockIds: ['b2'] }] }),
      blocks,
    )
    expect([...ids].sort()).toEqual(['b1', 'b2', 'b3'])
  })
})

describe('buildArticleQualityReport', () => {
  it('approves a faithful, fully-covered, fully-traced article', () => {
    const report = buildArticleQualityReport(input())
    expect(report.blockerReasons).toEqual([])
    expect(isBlockedByReview(report)).toBe(false)
    expect(report.sourceCoverageScore).toBe(100)
    expect(report.importantSourceCoverageScore).toBe(100)
    expect(report.citationCoverageScore).toBe(100)
    expect(report.provenanceCompletenessScore).toBe(100)
    expect(report.regenerationHints).toEqual([])
    // The shape round-trips through the persistence/read-back schema.
    expect(() => ArticleQualityReportV3Schema.parse(report)).not.toThrow()
  })

  it('differentiates RAW from IMPORTANT source coverage and blocks the gap', () => {
    // 4 blocks: 3 trivial (represented) + 1 important claim block b4 (NOT
    // represented). Raw coverage is high; important coverage collapses.
    const blocks: ReviewBlock[] = [
      { id: 'b1', classification: 'BACKGROUND', removable: false },
      { id: 'b2', classification: 'BACKGROUND', removable: false },
      { id: 'b3', classification: 'BACKGROUND', removable: false },
      { id: 'b4', classification: 'MAIN_ARGUMENT', removable: false },
    ]
    const report = buildArticleQualityReport(
      input({
        blocks,
        structureModel: sm({
          claims: [{ text: 'key', sourceBlockIds: ['b4'] }],
        }),
        coverageReport: coverage({
          totalBlocks: 4,
          coveragePercent: 75, // 3 of 4 represented
          representedBlockIds: ['b1', 'b2', 'b3'],
        }),
      }),
    )
    expect(report.sourceCoverageScore).toBe(75)
    expect(report.importantSourceCoverageScore).toBe(0)
    const gap = report.blockerReasons.find(
      (r) => r.code === 'important_coverage_gap',
    )
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('high')
    // Lost information is tied to the specific source block id that was dropped.
    expect(gap?.sourceBlockIds).toEqual(['b4'])
    expect(isBlockedByReview(report)).toBe(true)
  })

  it('FAILING EXAMPLE 1 — unsupported additions are counted, tied to article refs, and block', () => {
    const report = buildArticleQualityReport(
      input({
        fidelityReport: fidelity({
          addedInformation: [
            {
              severity: 'high',
              description: 'an invented statistic',
              articleRef: 'sp1',
            },
          ],
          unsupportedExamples: [
            {
              severity: 'low',
              description: 'a soft example',
              articleRef: 'sp2',
            },
          ],
        }),
      }),
    )
    expect(report.unsupportedClaimCount).toBe(2)
    const blocker = report.blockerReasons.find(
      (r) => r.code === 'unsupported_claims',
    )
    expect(blocker).toBeDefined()
    expect(blocker?.articleRefs).toEqual(['sp1'])
    expect(blocker?.stage).toBe('generator')
    expect(blocker?.message).toMatch(/sp1/)
    expect(isBlockedByReview(report)).toBe(true)
    expect(
      report.regenerationHints.some((h) => /regenerate the article/i.test(h)),
    ).toBe(true)
  })

  it('FAILING EXAMPLE 2 — lost high-importance info is tied to source block IDs and blocks', () => {
    const report = buildArticleQualityReport(
      input({
        fidelityReport: fidelity({
          lostInformation: [
            {
              severity: 'high',
              description: 'a core claim was dropped',
              sourceBlockIds: ['b2'],
            },
          ],
          missingCaveats: [
            {
              severity: 'high',
              description: 'a caveat was dropped',
              sourceBlockIds: ['b3'],
            },
          ],
        }),
      }),
    )
    expect(report.highSeverityLostInfoCount).toBe(2)
    const blocker = report.blockerReasons.find(
      (r) => r.code === 'lost_information',
    )
    expect(blocker).toBeDefined()
    expect(blocker?.sourceBlockIds?.sort()).toEqual(['b2', 'b3'])
    expect(isBlockedByReview(report)).toBe(true)
  })

  it('flags missing source traces when a body block lacks valid provenance', () => {
    const report = buildArticleQualityReport(
      input({
        article: article({
          sections: [
            section(
              's1',
              [para('sp1', ['b1']), para('sp2', ['ghost'])],
              ['b1'],
            ),
          ],
        }),
      }),
    )
    // sp2 cites an unknown block → not fully traced.
    expect(report.provenanceCompletenessScore).toBeLessThan(100)
    const blocker = report.blockerReasons.find(
      (r) => r.code === 'missing_source_traces',
    )
    expect(blocker).toBeDefined()
    expect(blocker?.articleRefs).toContain('sp2')
    expect(blocker?.stage).toBe('generator')
  })

  it('lowers citation coverage when a body block carries no sourceBlockIds at all', () => {
    const report = buildArticleQualityReport(
      input({
        article: article({
          sections: [
            section('s1', [para('sp1', ['b1']), para('sp2', [])], ['b1']),
          ],
        }),
      }),
    )
    // 3 body fragments (abstract p1, sp1, sp2); 2 cite a source → 67%.
    expect(report.citationCoverageScore).toBe(67)
  })

  it('produces stage-targeted regeneration hints in pipeline order, one per stage', () => {
    const report = buildArticleQualityReport(
      input({
        fidelityReport: fidelity({
          addedInformation: [
            { severity: 'high', description: 'added', articleRef: 'sp1' },
          ],
          emphasisChanges: [
            { severity: 'high', description: 'reorder shifts the takeaway' },
          ],
        }),
      }),
    )
    // generator (unsupported_claims) + reshaping-plan (emphasis_shift) blockers.
    expect(report.regenerationHints).toHaveLength(2)
    // reshaping-plan is earlier in the pipeline than the generator → listed first.
    expect(report.regenerationHints[0]).toMatch(/reshaping plan/i)
    expect(report.regenerationHints[0]).toMatch(/emphasis_shift/)
    expect(report.regenerationHints[1]).toMatch(/regenerate the article/i)
    expect(report.regenerationHints[1]).toMatch(/unsupported_claims/)
  })

  it('counts tables, callouts, concepts, key claims and retrieval prompts', () => {
    const table: ArticleBlock = {
      id: 'tb1',
      type: 'table',
      rows: [['a', 'b']],
      sourceBlockIds: ['b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    }
    const callout: ArticleBlock = {
      id: 'cb1',
      type: 'callout',
      text: 'note',
      sourceBlockIds: ['b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    }
    const report = buildArticleQualityReport(
      input({
        article: article({
          sections: [
            section('s1', [para('sp1', ['b1']), table, callout], ['b1']),
          ],
        }),
        structureModel: sm({
          claims: [
            { text: 'c1', sourceBlockIds: ['b1'] },
            { text: 'c2', sourceBlockIds: ['b1'] },
          ],
        }),
        learningLayer: {
          concepts: [
            {
              id: 'c1',
              label: 'L',
              definition: 'D',
              sourceBlockIds: ['b1'],
              validationStatus: 'pending',
            },
          ],
          retrievalPrompts: [
            { id: 'r1', prompt: 'Q?', sourceBlockIds: ['b1'] },
          ],
        },
      }),
    )
    expect(report.tableCount).toBe(1)
    expect(report.calloutCount).toBe(1)
    expect(report.conceptCandidateCount).toBe(1)
    expect(report.keyClaimCount).toBe(2)
    expect(report.retrievalPromptCount).toBe(1)
  })

  it('scales exercise readiness with concept + retrieval coverage of key claims', () => {
    const lean = buildArticleQualityReport(
      input({
        structureModel: sm({ claims: [{ text: 'c', sourceBlockIds: ['b1'] }] }),
      }),
    )
    // No concepts / prompts for 1 key claim → 0 readiness, surfaced as a warning.
    expect(lean.exerciseReadinessScore).toBe(0)
    expect(
      lean.reviewerWarnings.some((w) => /retrieval prompts/i.test(w)),
    ).toBe(true)

    const rich = buildArticleQualityReport(
      input({
        structureModel: sm({ claims: [{ text: 'c', sourceBlockIds: ['b1'] }] }),
        learningLayer: {
          concepts: [
            {
              id: 'c1',
              label: 'L',
              definition: 'D',
              sourceBlockIds: ['b1'],
              validationStatus: 'pending',
            },
          ],
          retrievalPrompts: [
            { id: 'r1', prompt: 'Q?', sourceBlockIds: ['b1'] },
          ],
        },
      }),
    )
    expect(rich.exerciseReadinessScore).toBe(100)
  })

  it('penalises readability for very long paragraphs', () => {
    const wall = 'word '.repeat(260)
    const report = buildArticleQualityReport(
      input({
        article: article({
          sections: [section('s1', [para('sp1', ['b1'], wall)], ['b1'])],
        }),
      }),
    )
    expect(report.articleReadabilityScore).toBeLessThan(100)
  })
})
