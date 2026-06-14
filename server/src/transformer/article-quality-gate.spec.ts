import {
  type ArticleGateInput,
  type ArticleQualityThresholds,
  buildArticleQualityReport,
  DEFAULT_ARTICLE_QUALITY_THRESHOLDS,
  evaluateQualityGates,
  importantCoverageScore,
  isBlockedStatus,
  minImportantCoverageForKind,
} from './article-quality-gate'

/** A signal set that passes every gate — tests override one field at a time. */
function passingInput(over: Partial<ArticleGateInput> = {}): ArticleGateInput {
  return {
    sourceKind: 'structured_web_article',
    conceptRich: true,
    fidelityApproved: true,
    importantSourceCoverageScore: 1,
    unsupportedClaimCount: 0,
    conceptCandidateCount: 5,
    highSeverityLostInfoCount: 0,
    ...over,
  }
}

describe('DEFAULT_ARTICLE_QUALITY_THRESHOLDS', () => {
  it('matches the DET-355 spec defaults', () => {
    expect(DEFAULT_ARTICLE_QUALITY_THRESHOLDS).toEqual({
      minTranscriptImportantCoverageScore: 0.8,
      minStructuredArticleImportantCoverageScore: 0.7,
      maxUnsupportedClaimCount: 0,
      minConceptCandidateCount: 3,
      minExerciseReadinessScore: 0.7,
      maxHighSeverityLostInfoItems: 0,
    })
  })
})

describe('minImportantCoverageForKind', () => {
  const t = DEFAULT_ARTICLE_QUALITY_THRESHOLDS
  it('holds transcript lessons to the stricter 0.8 bar', () => {
    expect(minImportantCoverageForKind('transcript_lesson', t)).toBe(0.8)
  })
  it('holds structured kinds to the 0.7 bar', () => {
    expect(minImportantCoverageForKind('structured_web_article', t)).toBe(0.7)
    expect(minImportantCoverageForKind('research_paper', t)).toBe(0.7)
    expect(minImportantCoverageForKind('documentation', t)).toBe(0.7)
  })
  it('uses the looser structured bar for unknown/raw sources', () => {
    expect(minImportantCoverageForKind('unknown', t)).toBe(0.7)
    expect(minImportantCoverageForKind('raw_notes', t)).toBe(0.7)
  })
})

describe('importantCoverageScore', () => {
  it('scores 1 when there are no important blocks (nothing to miss)', () => {
    const blocks = [
      { id: 'a', important: false },
      { id: 'b', important: false },
    ]
    expect(importantCoverageScore(blocks, [])).toBe(1)
  })
  it('is the fraction of high-importance blocks represented', () => {
    const blocks = [
      { id: 'a', important: true },
      { id: 'b', important: true },
      { id: 'c', important: true },
      { id: 'd', important: true },
      { id: 'e', important: false },
    ]
    // 3 of 4 important blocks represented (the non-important one is ignored).
    expect(importantCoverageScore(blocks, ['a', 'b', 'c', 'e'])).toBe(0.75)
  })
  it('ignores represented ids that are not important blocks', () => {
    const blocks = [{ id: 'a', important: true }]
    expect(importantCoverageScore(blocks, ['a', 'zzz'])).toBe(1)
  })
})

describe('evaluateQualityGates — passing', () => {
  it('returns READY_FOR_REVIEW with no reasons or hints when all gates pass', () => {
    const result = evaluateQualityGates(passingInput())
    expect(result.status).toBe('READY_FOR_REVIEW')
    expect(result.blockerReasons).toEqual([])
    expect(result.regenerationHints).toEqual([])
  })
})

describe('evaluateQualityGates — unsupported claims (AC: cannot enter review)', () => {
  it('blocks any unsupported claim by default (max 0)', () => {
    const result = evaluateQualityGates(
      passingInput({ unsupportedClaimCount: 1 }),
    )
    expect(result.status).toBe('BLOCKED_UNSUPPORTED_CLAIMS')
    const reason = result.blockerReasons.find(
      (r) => r.code === 'unsupported_claims',
    )
    expect(reason).toBeDefined()
    expect(reason?.qualityReportRef).toBe('unsupportedClaimCount')
    expect(result.regenerationHints.length).toBeGreaterThan(0)
  })
  it('respects a raised tolerance threshold', () => {
    const thresholds: ArticleQualityThresholds = {
      ...DEFAULT_ARTICLE_QUALITY_THRESHOLDS,
      maxUnsupportedClaimCount: 2,
    }
    expect(
      evaluateQualityGates(
        passingInput({ unsupportedClaimCount: 2 }),
        thresholds,
      ).status,
    ).toBe('READY_FOR_REVIEW')
    expect(
      evaluateQualityGates(
        passingInput({ unsupportedClaimCount: 3 }),
        thresholds,
      ).status,
    ).toBe('BLOCKED_UNSUPPORTED_CLAIMS')
  })
})

describe('evaluateQualityGates — important coverage (AC: 80% / 70%)', () => {
  it('blocks a transcript lesson below 80% important coverage', () => {
    const result = evaluateQualityGates(
      passingInput({
        sourceKind: 'transcript_lesson',
        importantSourceCoverageScore: 0.79,
      }),
    )
    expect(result.status).toBe('BLOCKED_LOW_COVERAGE')
    expect(
      result.blockerReasons.find((r) => r.code === 'low_coverage')
        ?.qualityReportRef,
    ).toBe('importantSourceCoverageScore')
  })
  it('passes a transcript lesson at exactly 80% important coverage', () => {
    expect(
      evaluateQualityGates(
        passingInput({
          sourceKind: 'transcript_lesson',
          importantSourceCoverageScore: 0.8,
        }),
      ).status,
    ).toBe('READY_FOR_REVIEW')
  })
  it('blocks a structured explainer below 70% but passes at 70%', () => {
    expect(
      evaluateQualityGates(
        passingInput({
          sourceKind: 'structured_web_article',
          importantSourceCoverageScore: 0.69,
        }),
      ).status,
    ).toBe('BLOCKED_LOW_COVERAGE')
    expect(
      evaluateQualityGates(
        passingInput({
          sourceKind: 'structured_web_article',
          importantSourceCoverageScore: 0.7,
        }),
      ).status,
    ).toBe('READY_FOR_REVIEW')
  })
  it('a transcript at 0.75 (would pass structured) still blocks at the stricter bar', () => {
    expect(
      evaluateQualityGates(
        passingInput({
          sourceKind: 'transcript_lesson',
          importantSourceCoverageScore: 0.75,
        }),
      ).status,
    ).toBe('BLOCKED_LOW_COVERAGE')
  })
})

describe('evaluateQualityGates — missing concepts (AC: concept-rich < 3)', () => {
  it('blocks a concept-rich source with fewer than 3 candidates', () => {
    const result = evaluateQualityGates(
      passingInput({ conceptRich: true, conceptCandidateCount: 2 }),
    )
    expect(result.status).toBe('BLOCKED_MISSING_CONCEPTS')
    expect(
      result.blockerReasons.find((r) => r.code === 'missing_concepts')
        ?.qualityReportRef,
    ).toBe('conceptCandidateCount')
  })
  it('does NOT block a non-concept-rich source with few candidates', () => {
    expect(
      evaluateQualityGates(
        passingInput({ conceptRich: false, conceptCandidateCount: 0 }),
      ).status,
    ).toBe('READY_FOR_REVIEW')
  })
  it('passes a concept-rich source at exactly the minimum', () => {
    expect(
      evaluateQualityGates(
        passingInput({ conceptRich: true, conceptCandidateCount: 3 }),
      ).status,
    ).toBe('READY_FOR_REVIEW')
  })
})

describe('evaluateQualityGates — fidelity + lost information', () => {
  it('blocks when the fidelity checker did not approve', () => {
    const result = evaluateQualityGates(
      passingInput({ fidelityApproved: false }),
    )
    expect(result.status).toBe('BLOCKED_FIDELITY')
    expect(result.blockerReasons.some((r) => r.code === 'fidelity')).toBe(true)
  })
  it('blocks on a high-severity lost-information finding', () => {
    const result = evaluateQualityGates(
      passingInput({ highSeverityLostInfoCount: 1 }),
    )
    expect(result.status).toBe('BLOCKED_FIDELITY')
    expect(
      result.blockerReasons.some((r) => r.code === 'lost_information'),
    ).toBe(true)
  })
})

describe('evaluateQualityGates — exercise readiness (optional gate)', () => {
  it('is skipped when no readiness score is supplied', () => {
    expect(
      evaluateQualityGates(passingInput({ exerciseReadinessScore: undefined }))
        .status,
    ).toBe('READY_FOR_REVIEW')
  })
  it('blocks when a supplied readiness score is below the threshold', () => {
    const result = evaluateQualityGates(
      passingInput({ exerciseReadinessScore: 0.5 }),
    )
    expect(
      result.blockerReasons.some((r) => r.code === 'weak_exercise_readiness'),
    ).toBe(true)
  })
  it('passes when a supplied readiness score meets the threshold', () => {
    expect(
      evaluateQualityGates(passingInput({ exerciseReadinessScore: 0.7 }))
        .status,
    ).toBe('READY_FOR_REVIEW')
  })
})

describe('evaluateQualityGates — multiple failures + priority', () => {
  it('surfaces every failing reason but heads the banner with the highest priority', () => {
    const result = evaluateQualityGates(
      passingInput({
        unsupportedClaimCount: 1,
        importantSourceCoverageScore: 0.1,
        conceptCandidateCount: 0,
        fidelityApproved: false,
      }),
    )
    // Unsupported claims outranks the others for the single banner status.
    expect(result.status).toBe('BLOCKED_UNSUPPORTED_CLAIMS')
    const codes = result.blockerReasons.map((r) => r.code)
    expect(codes).toEqual(
      expect.arrayContaining([
        'unsupported_claims',
        'fidelity',
        'low_coverage',
        'missing_concepts',
      ]),
    )
    // One hint per reason.
    expect(result.regenerationHints).toHaveLength(result.blockerReasons.length)
  })
  it('falls back to low_coverage status when claims/fidelity pass but coverage + concepts fail', () => {
    const result = evaluateQualityGates(
      passingInput({
        importantSourceCoverageScore: 0.1,
        conceptCandidateCount: 0,
      }),
    )
    expect(result.status).toBe('BLOCKED_LOW_COVERAGE')
  })
})

describe('isBlockedStatus', () => {
  it('treats BLOCKED_* and NEEDS_REGENERATION as held back', () => {
    expect(isBlockedStatus('BLOCKED_LOW_COVERAGE')).toBe(true)
    expect(isBlockedStatus('BLOCKED_UNSUPPORTED_CLAIMS')).toBe(true)
    expect(isBlockedStatus('NEEDS_REGENERATION')).toBe(true)
  })
  it('treats READY_FOR_REVIEW / FINAL / DRAFT / GENERATING as not held back', () => {
    expect(isBlockedStatus('READY_FOR_REVIEW')).toBe(false)
    expect(isBlockedStatus('FINAL')).toBe(false)
    expect(isBlockedStatus('DRAFT')).toBe(false)
    expect(isBlockedStatus('GENERATING')).toBe(false)
  })
})

describe('buildArticleQualityReport', () => {
  const gate = evaluateQualityGates(passingInput({ unsupportedClaimCount: 1 }))

  it('mirrors the gate decision and clamps scores into range', () => {
    const report = buildArticleQualityReport(
      {
        sourceCoverageScore: 1.4, // out of range — clamps to 1
        importantSourceCoverageScore: 0.5,
        citationCoverageScore: -0.2, // clamps to 0
        unsupportedClaimCount: 1,
        highSeverityLostInfoCount: 0,
        conceptCandidateCount: 4,
        keyClaimCount: 3,
        retrievalPromptCount: 0,
        tableCount: 2,
        calloutCount: 1,
        articleReadabilityScore: 0.9,
        provenanceCompletenessScore: 0.8,
      },
      gate,
    )
    expect(report.sourceCoverageScore).toBe(1)
    expect(report.citationCoverageScore).toBe(0)
    expect(report.exerciseReadinessScore).toBe(0) // defaulted (no score)
    expect(report.blockerReasons).toBe(gate.blockerReasons)
    expect(report.regenerationHints).toBe(gate.regenerationHints)
    expect(report.reviewerWarnings).toEqual([])
  })

  it('floors negative / non-finite counts at 0', () => {
    const report = buildArticleQualityReport(
      {
        sourceCoverageScore: 0.5,
        importantSourceCoverageScore: 0.5,
        citationCoverageScore: 0.5,
        unsupportedClaimCount: -3,
        highSeverityLostInfoCount: Number.NaN,
        conceptCandidateCount: 2.6, // rounds to 3
        keyClaimCount: 0,
        retrievalPromptCount: 0,
        tableCount: 0,
        calloutCount: 0,
        articleReadabilityScore: 0.5,
        provenanceCompletenessScore: 0.5,
      },
      evaluateQualityGates(passingInput()),
    )
    expect(report.unsupportedClaimCount).toBe(0)
    expect(report.highSeverityLostInfoCount).toBe(0)
    expect(report.conceptCandidateCount).toBe(3)
  })
})
