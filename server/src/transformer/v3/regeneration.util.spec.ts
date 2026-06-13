import { planRegeneration } from './regeneration.util'
import type { QualityBlocker, QualityReport } from './v3.types'

function report(
  status: QualityReport['status'],
  blockers: QualityBlocker[],
): QualityReport {
  return {
    status,
    sourceKind: 'structured_article',
    importantCoveragePercent: 50,
    importantCoverageThreshold: 70,
    unsupportedClaimCount: 0,
    conceptCandidateCount: 0,
    retrievalPromptCount: 0,
    exerciseReadiness: 30,
    groundedPercent: 80,
    blockers,
  }
}

const hard = (
  code: QualityBlocker['code'],
  refs: string[] = [],
): QualityBlocker => ({ code, severity: 'hard', message: code, refs })

describe('planRegeneration (DET-343)', () => {
  it('returns no targets for an already-passing report', () => {
    const plan = planRegeneration(report('READY_FOR_REVIEW', []))
    expect(plan.status).toBe('READY_FOR_REVIEW')
    expect(plan.targets).toHaveLength(0)
  })

  it('downgrades BLOCKED → NEEDS_REGENERATION when every hard blocker is addressable', () => {
    const plan = planRegeneration(
      report('BLOCKED', [
        hard('IMPORTANT_COVERAGE_BELOW_THRESHOLD', ['b3', 'b4']),
        hard('UNSUPPORTED_CLAIMS_PRESENT', ['uc-0']),
      ]),
    )
    expect(plan.status).toBe('NEEDS_REGENERATION')
    expect(plan.targets).toHaveLength(2)
    const coverageTarget = plan.targets.find(
      (t) => t.blocker === 'IMPORTANT_COVERAGE_BELOW_THRESHOLD',
    )
    expect(coverageTarget?.refs).toEqual(['b3', 'b4'])
    expect(coverageTarget?.instruction).toMatch(/missing important/i)
  })

  it('stays BLOCKED if any hard blocker is not addressable by regeneration', () => {
    const plan = planRegeneration(
      report('BLOCKED', [
        hard('UNSUPPORTED_CLAIMS_PRESENT'),
        // LOW_EXERCISE_READINESS is soft in practice; here we use a hard blocker
        // that is intentionally absent from the addressable set to prove the rule.
        {
          code: 'LOW_EXERCISE_READINESS',
          severity: 'hard',
          message: 'x',
          refs: [],
        },
      ]),
    )
    expect(plan.status).toBe('BLOCKED')
    expect(plan.targets).toHaveLength(0)
  })

  it('ignores soft blockers when deciding addressability', () => {
    const plan = planRegeneration(
      report('BLOCKED', [
        hard('NO_RETRIEVAL_PROMPTS'),
        {
          code: 'LOW_EXERCISE_READINESS',
          severity: 'soft',
          message: 'x',
          refs: [],
        },
      ]),
    )
    expect(plan.status).toBe('NEEDS_REGENERATION')
    expect(plan.targets).toHaveLength(1)
  })
})
