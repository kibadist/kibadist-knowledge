import {
  blockedRegressionFixtures,
  readyRegressionFixtures,
  releaseGateFixtures,
  type V3RegressionFixture,
  v3RegressionFixtures,
} from './__fixtures__/v3-regression'
import { ArticleJsonV3Schema } from './article-v3.schema'
import { resolveArticleGenerationVersion } from './article-v3-flag'
import {
  computeRegressionMetrics,
  evaluateReleaseGate,
  findUnknownGroundedCitations,
  knownBlockIds,
  type ReleaseGateThresholds,
} from './article-v3-metrics.util'
import { diagnoseSource } from './source-diagnosis.util'

/**
 * v3 article-generation REGRESSION SUITE (DET-361).
 *
 * Deterministic, network-free release gate for making the v3 (Source-Grounded
 * Learning Article) pipeline the default generator. Every fixture pairs source
 * blocks with the v3 article the generator is expected to produce; the suite runs
 * the pure detector + schema + metric helpers over each and asserts the known
 * article-generation failures stay fixed. CI fails the moment a regression drops a
 * fixture below its thresholds (or lets a blocked output through).
 *
 * Covered (per the ticket):
 *  1. transformer-architecture transcript, 2. structured systems article,
 *  3. short raw note, 4. documentation source, 5. research-paper source, and
 *  6. an intentionally BLOCKED transcript (negative case).
 */

function thresholdsFor(f: V3RegressionFixture): ReleaseGateThresholds {
  return {
    minImportantCoverage: f.expectations.minImportantCoverage,
    minConceptCandidates: f.expectations.minConceptCandidates,
    minRetrievalPrompts: f.expectations.minRetrievalPrompts,
    maxUnsupportedClaims: f.expectations.unsupportedClaimCount,
  }
}

// ---------------------------------------------------------------------------
// Per-fixture invariants — diagnosis, schema, and the metric thresholds.
// ---------------------------------------------------------------------------

describe.each(
  v3RegressionFixtures.map((f) => [f.name, f] as const),
)('v3 regression fixture: %s', (_name, fixture) => {
  it('detects the expected source kind and article shape', () => {
    const d = diagnoseSource(fixture.blocks, fixture.metadata)
    expect(d.sourceKind).toBe(fixture.expectations.sourceKind)
    expect(d.articleShape).toBe(fixture.expectations.articleShape)
  })

  it('is a schema-valid Article JSON v3', () => {
    const result = ArticleJsonV3Schema.safeParse(fixture.article)
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it('meets its concept-candidate, retrieval-prompt and coverage minimums', () => {
    const m = computeRegressionMetrics(fixture.article, fixture.blocks)
    expect(m.conceptCandidateCount).toBeGreaterThanOrEqual(
      fixture.expectations.minConceptCandidates,
    )
    expect(m.retrievalPromptCount).toBeGreaterThanOrEqual(
      fixture.expectations.minRetrievalPrompts,
    )
    expect(m.importantCoverage).toBeGreaterThanOrEqual(
      fixture.expectations.minImportantCoverage,
    )
  })

  it('carries exactly the expected unsupported-claim count and status', () => {
    const m = computeRegressionMetrics(fixture.article, fixture.blocks)
    expect(m.unsupportedClaimCount).toBe(
      fixture.expectations.unsupportedClaimCount,
    )
    expect(m.status).toBe(fixture.expectations.status)
  })
})

// ---------------------------------------------------------------------------
// READY fixtures — every grounded citation is traceable, the gate passes.
// ---------------------------------------------------------------------------

describe('ready fixtures clear the release gate', () => {
  it.each(
    readyRegressionFixtures.map((f) => [f.name, f] as const),
  )('%s: every grounded citation is traceable and the gate passes', (_name, fixture) => {
    const known = knownBlockIds(fixture.blocks)
    expect(findUnknownGroundedCitations(fixture.article, known)).toEqual([])

    const result = evaluateReleaseGate(
      fixture.article,
      fixture.blocks,
      thresholdsFor(fixture),
    )
    if (!result.passed) {
      throw new Error(`gate failed: ${result.failures.join('; ')}`)
    }
    expect(result.passed).toBe(true)
  })

  it('there is at least one ready fixture', () => {
    expect(readyRegressionFixtures.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// BLOCKED fixtures — the negative case the gate must reject.
// ---------------------------------------------------------------------------

describe('blocked fixtures are rejected by the gate', () => {
  it('covers at least one intentionally blocked output', () => {
    expect(blockedRegressionFixtures.length).toBeGreaterThan(0)
  })

  it.each(
    blockedRegressionFixtures.map((f) => [f.name, f] as const),
  )('%s: status is blocked, has an untraceable citation, and fails the gate', (_name, fixture) => {
    const m = computeRegressionMetrics(fixture.article, fixture.blocks)
    expect(m.status).toBe('blocked')
    // The traceability break the metrics catch even though the schema accepts it.
    expect(m.unknownGroundedCitations.length).toBeGreaterThan(0)
    expect(m.unsupportedClaimCount).toBeGreaterThan(0)

    // A blocked output can never be release-eligible, whatever thresholds we use.
    const result = evaluateReleaseGate(fixture.article, fixture.blocks, {
      minImportantCoverage: 0,
      minConceptCandidates: 0,
      minRetrievalPrompts: 0,
      maxUnsupportedClaims: 0,
    })
    expect(result.passed).toBe(false)
  })

  it('the schema still accepts a blocked article (the gate is a code check, not a schema check)', () => {
    for (const f of blockedRegressionFixtures) {
      expect(ArticleJsonV3Schema.safeParse(f.article).success).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Acceptance criteria — explicit, named on the ticket.
// ---------------------------------------------------------------------------

describe('acceptance criteria (DET-361)', () => {
  it('transformer transcript: lesson_article, >=80% coverage, >=8 concepts, >=5 prompts, 0 unsupported', () => {
    const { transcript } = releaseGateFixtures
    const d = diagnoseSource(transcript.blocks, transcript.metadata)
    expect(d.sourceKind).toBe('transcript_lesson')
    expect(d.articleShape).toBe('lesson_article')

    const m = computeRegressionMetrics(transcript.article, transcript.blocks)
    expect(m.importantCoverage).toBeGreaterThanOrEqual(0.8)
    expect(m.conceptCandidateCount).toBeGreaterThanOrEqual(8)
    expect(m.retrievalPromptCount).toBeGreaterThanOrEqual(5)
    expect(m.unsupportedClaimCount).toBe(0)
    expect(m.status).toBe('ready')
  })

  it('systems article: concept_explainer, >=70% coverage, >=10 concepts, >=5 prompts, 0 unsupported', () => {
    const { systems } = releaseGateFixtures
    const d = diagnoseSource(systems.blocks, systems.metadata)
    expect(d.sourceKind).toBe('structured_web_article')
    expect(d.articleShape).toBe('concept_explainer')

    const m = computeRegressionMetrics(systems.article, systems.blocks)
    expect(m.importantCoverage).toBeGreaterThanOrEqual(0.7)
    expect(m.conceptCandidateCount).toBeGreaterThanOrEqual(10)
    expect(m.retrievalPromptCount).toBeGreaterThanOrEqual(5)
    expect(m.unsupportedClaimCount).toBe(0)
    expect(m.status).toBe('ready')
  })

  it('CI fails if a regression produces conceptCandidateCount = 0 for concept-rich sources', () => {
    // The two named concept-rich sources must always extract concepts.
    for (const f of [
      releaseGateFixtures.transcript,
      releaseGateFixtures.systems,
    ]) {
      const m = computeRegressionMetrics(f.article, f.blocks)
      expect(m.conceptCandidateCount).toBeGreaterThan(0)
    }

    // And the gate must REJECT a regression that empties the concept list — this
    // is exactly the `conceptCandidateCount: 0` failure mode the gate exists for.
    const regressed = {
      ...releaseGateFixtures.transcript.article,
      keyConcepts: [],
    }
    const result = evaluateReleaseGate(
      regressed,
      releaseGateFixtures.transcript.blocks,
      thresholdsFor(releaseGateFixtures.transcript),
    )
    expect(result.passed).toBe(false)
    expect(result.metrics.conceptCandidateCount).toBe(0)
    expect(result.failures.some((m) => /conceptCandidateCount/.test(m))).toBe(
      true,
    )
  })

  it('CI fails if unsupportedClaimCount > 0 for default source-grounded mode', () => {
    // Default (source-grounded) mode: every ready fixture has zero unsupported claims.
    for (const f of readyRegressionFixtures) {
      const m = computeRegressionMetrics(f.article, f.blocks)
      expect(m.unsupportedClaimCount).toBe(0)
    }

    // Injecting an untraceable claim must trip the gate.
    const base = releaseGateFixtures.systems.article
    const regressed = {
      ...base,
      keyClaims: [
        ...base.keyClaims,
        {
          id: 'cl-injected',
          statement: 'An invented claim with no source.',
          claimType: 'fact' as const,
          sourceTrace: {
            grounded: true,
            sourceBlockIds: ['does-not-exist'],
            transformationType: 'light_reword' as const,
            fidelityRisk: 'low' as const,
          },
        },
      ],
    }
    const result = evaluateReleaseGate(
      regressed,
      releaseGateFixtures.systems.blocks,
      thresholdsFor(releaseGateFixtures.systems),
    )
    expect(result.passed).toBe(false)
    expect(result.metrics.unsupportedClaimCount).toBeGreaterThan(0)
  })

  it('covers both successful and intentionally blocked generation outputs', () => {
    expect(readyRegressionFixtures.length).toBeGreaterThan(0)
    expect(blockedRegressionFixtures.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Architecture-note guarantees (Max I's comment) — the v3 release gate.
// ---------------------------------------------------------------------------

describe('v3 release-gate guarantees (architecture note)', () => {
  it('v2 remains the default fallback when the flag is off', () => {
    expect(resolveArticleGenerationVersion({})).toBe('v2')
    expect(
      resolveArticleGenerationVersion({ ARTICLE_V3_ENABLED: 'false' }),
    ).toBe('v2')
  })

  it('v3 can be enabled/disabled by feature flag', () => {
    expect(
      resolveArticleGenerationVersion({ ARTICLE_V3_ENABLED: 'true' }),
    ).toBe('v3')
    expect(resolveArticleGenerationVersion({ ARTICLE_V3_ENABLED: '1' })).toBe(
      'v3',
    )
    expect(resolveArticleGenerationVersion({ ARTICLE_V3_ENABLED: 'off' })).toBe(
      'v2',
    )
  })

  it('v3 must not become default until BOTH release-gate fixtures pass their thresholds', () => {
    for (const f of [
      releaseGateFixtures.transcript,
      releaseGateFixtures.systems,
    ]) {
      const result = evaluateReleaseGate(f.article, f.blocks, thresholdsFor(f))
      if (!result.passed) {
        throw new Error(`${f.name} gate failed: ${result.failures.join('; ')}`)
      }
      expect(result.passed).toBe(true)
    }
  })

  it('does not regress into v2-style fragmented transcript sections', () => {
    // A v2-style failure splits a transcript into one tiny section per utterance.
    // The v3 lesson groups utterances into a few learning sections.
    const { transcript } = releaseGateFixtures
    const contentBlocks = transcript.blocks.filter((b) => !b.removable).length
    expect(transcript.article.sections.length).toBeLessThanOrEqual(
      Math.ceil(contentBlocks / 3),
    )
    // Each section must group more than one source block (no one-block fragments).
    for (const s of transcript.article.sections) {
      expect(s.blocks.length).toBeGreaterThan(1)
    }
  })

  it('does not copy the source layout — sections are fewer than source blocks', () => {
    for (const f of readyRegressionFixtures) {
      expect(f.article.sections.length).toBeLessThan(f.blocks.length)
    }
  })

  it('does not plan illustrations before article quality passes (no figures in blocked output)', () => {
    for (const f of blockedRegressionFixtures) {
      const hasFigure = (sections: typeof f.article.sections): boolean =>
        sections.some(
          (s) =>
            s.blocks.some((b) => b.type === 'figure') ||
            (s.subsections ? hasFigure(s.subsections) : false),
        )
      expect(hasFigure(f.article.sections)).toBe(false)
    }
  })
})
