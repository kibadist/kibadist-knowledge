import type { QualityGateResultV3 } from './quality-gate.util'
import { planRegenerationV3 } from './regeneration.util'

function result(
  codes: QualityGateResultV3['hardBlockerCodes'],
): QualityGateResultV3 {
  return {
    status: codes.length ? 'BLOCKED_LOW_COVERAGE' : 'READY_FOR_REVIEW',
    hardBlockerCodes: codes,
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
  }
}

describe('v3 regeneration planning', () => {
  it('does not regenerate a passed article', () => {
    expect(planRegenerationV3(result([])).shouldRegenerate).toBe(false)
  })

  it('regenerates when all hard blockers are addressable, one target each', () => {
    const plan = planRegenerationV3(
      result(['low_coverage', 'missing_concepts']),
    )
    expect(plan.shouldRegenerate).toBe(true)
    expect(plan.targets.map((t) => t.blocker)).toEqual([
      'low_coverage',
      'missing_concepts',
    ])
  })

  it('dedupes repeated blocker codes', () => {
    const plan = planRegenerationV3(result(['low_coverage', 'low_coverage']))
    expect(plan.targets).toHaveLength(1)
  })

  it('does NOT regenerate when a non-addressable blocker is present', () => {
    expect(planRegenerationV3(result(['fidelity'])).shouldRegenerate).toBe(
      false,
    )
  })
})
