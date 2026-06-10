import { buildQualityReport } from './quality-report.util'
import type {
  ArticleBlock,
  ArticleJsonV2,
  CoverageReport,
  FidelityFinding,
  FidelityReport,
} from './transformer.types'

function paragraph(
  id: string,
  over: Partial<Extract<ArticleBlock, { type: 'paragraph' }>> = {},
): ArticleBlock {
  return {
    id,
    type: 'paragraph',
    text: `Text of ${id}.`,
    sourceBlockIds: ['src-1'],
    transformationType: 'light_reword',
    fidelityRisk: 'low',
    ...over,
  }
}

function article(over: Partial<ArticleJsonV2> = {}): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections: [
      {
        id: 'sec-1',
        heading: 'A',
        headingSource: 'original',
        sourceBlockIds: ['src-1'],
        blocks: [paragraph('p1'), paragraph('p2')],
      },
    ],
    keyTerms: [{ term: 'Vector', sourceBlockIds: ['src-1'] }],
    sourceExamples: [{ text: 'Example.', sourceBlockIds: ['src-1'] }],
    caveats: [],
    originalStructure: [],
    readingAids: {
      toc: [],
      readingTime: { wordCount: 100, minutes: 1 },
      highlights: [{ text: 'A claim.', sourceBlockIds: ['src-1'] }],
    },
    ...over,
  }
}

function finding(
  severity: FidelityFinding['severity'],
  description: string,
): FidelityFinding {
  return { severity, description }
}

function fidelity(over: Partial<FidelityReport> = {}): FidelityReport {
  return {
    fidelityScore: 92,
    approved: true,
    addedInformation: [],
    lostInformation: [],
    meaningChanges: [],
    unsupportedHeadings: [],
    missingCaveats: [],
    unsupportedExamples: [],
    emphasisChanges: [],
    structuralFindings: [],
    ...over,
  }
}

function coverage(over: Partial<CoverageReport> = {}): CoverageReport {
  return {
    totalBlocks: 10,
    coveragePercent: 90,
    representedBlockIds: [],
    removedBlocks: [],
    uncertainBlockIds: [],
    unrepresentedBlockIds: [],
    paragraphMap: [],
    ...over,
  }
}

describe('buildQualityReport', () => {
  it('rolls a clean article up to high scores and zero warnings', () => {
    const report = buildQualityReport({
      article: article(),
      fidelity: fidelity(),
      coverage: coverage(),
    })
    expect(report.sourceCoverageScore).toBe(0.9)
    expect(report.citationCoverageScore).toBe(1)
    expect(report.unsupportedClaimCount).toBe(0)
    expect(report.lowConfidenceBlockCount).toBe(0)
    expect(report.exerciseReadinessScore).toBe(1)
    expect(report.reviewerWarnings).toEqual([])
  })

  it('is deterministic for a fixed artifact set', () => {
    const args = {
      article: article(),
      fidelity: fidelity({
        addedInformation: [finding('high', 'Invented a date')],
      }),
      coverage: coverage({ coveragePercent: 62.4 }),
    }
    expect(buildQualityReport(args)).toEqual(buildQualityReport(args))
  })

  it('counts unsupported additions and surfaces them as warnings', () => {
    const report = buildQualityReport({
      article: article(),
      fidelity: fidelity({
        addedInformation: [finding('high', 'Invented a date')],
        unsupportedHeadings: [finding('low', 'Heading not in source')],
        unsupportedExamples: [finding('medium', 'New example')],
      }),
      coverage: coverage(),
    })
    expect(report.unsupportedClaimCount).toBe(3)
    expect(report.reviewerWarnings).toContain(
      'Added information: Invented a date',
    )
    expect(report.reviewerWarnings).toContain(
      '3 unsupported addition(s) flagged by the fidelity check',
    )
    // Unsupported additions cost exercise readiness its honesty weight.
    expect(report.exerciseReadinessScore).toBe(0.9)
  })

  it('counts high fidelity-risk blocks across sections and subsections', () => {
    const a = article({
      sections: [
        {
          id: 'sec-1',
          heading: 'A',
          headingSource: 'original',
          sourceBlockIds: ['src-1'],
          blocks: [paragraph('p1', { fidelityRisk: 'high' })],
          subsections: [
            {
              id: 'sec-1-1',
              heading: 'A.1',
              headingSource: 'original',
              sourceBlockIds: ['src-1'],
              blocks: [
                paragraph('p2', { fidelityRisk: 'high' }),
                {
                  id: 't1',
                  type: 'table',
                  rows: [['a', 'b']],
                  sourceBlockIds: ['src-1'],
                  transformationType: 'formatting_only',
                  fidelityRisk: 'low',
                },
              ],
            },
          ],
        },
      ],
    })
    const report = buildQualityReport({
      article: a,
      fidelity: fidelity(),
      coverage: coverage(),
    })
    expect(report.lowConfidenceBlockCount).toBe(2)
    expect(report.tableCount).toBe(1)
    expect(report.reviewerWarnings).toContain(
      '2 block(s) carry high fidelity risk',
    )
  })

  it('flags low source coverage and reduces readiness', () => {
    const report = buildQualityReport({
      article: article(),
      fidelity: fidelity(),
      coverage: coverage({ coveragePercent: 55 }),
    })
    expect(report.sourceCoverageScore).toBe(0.55)
    expect(report.exerciseReadinessScore).toBe(0.85)
    expect(
      report.reviewerWarnings.some((w) => w.includes('Source coverage is 55%')),
    ).toBe(true)
  })

  it('counts the optional lanes when present and reads 0 when absent', () => {
    const base = {
      article: article(),
      fidelity: fidelity(),
      coverage: coverage(),
    }
    expect(buildQualityReport(base).figureSuggestionCount).toBe(0)
    expect(buildQualityReport(base).conceptCandidateCount).toBe(0)

    const withLanes = buildQualityReport({
      ...base,
      illustrationPlan: {
        suggestions: [
          {
            id: 'i1',
            illustrationType: 'editorial_cover',
            purpose: 'p',
            visualDescription: 'v',
            caption: 'c',
            fidelityRisk: 'low',
            reason: 'r',
            sourceBlockIds: ['src-1'],
            approval: 'pending',
          },
        ],
      },
      learningLayer: {
        concepts: [
          {
            id: 'lc1',
            label: 'L',
            definition: 'D',
            sourceBlockIds: ['src-1'],
            validationStatus: 'pending',
          },
        ],
        retrievalPrompts: [],
        conceptCandidates: [
          {
            id: 'cc1',
            sectionId: 'sec-1',
            label: 'C',
            definition: 'D',
            sourceBlockIds: ['src-1'],
            aiAssisted: true,
            validationStatus: 'pending',
          },
        ],
      },
    })
    expect(withLanes.figureSuggestionCount).toBe(1)
    expect(withLanes.conceptCandidateCount).toBe(2)
  })

  it('handles an empty article without dividing by zero', () => {
    const report = buildQualityReport({
      article: article({
        sections: [],
        keyTerms: [],
        sourceExamples: [],
        caveats: [],
        readingAids: undefined,
      }),
      fidelity: fidelity(),
      coverage: coverage({ coveragePercent: 0 }),
    })
    expect(report.citationCoverageScore).toBe(0)
    expect(report.sourceCoverageScore).toBe(0)
    expect(report.exerciseReadinessScore).toBe(0.1)
  })
})
