import { makeBlocks, makeV3Article } from './__fixtures__/v3-fixtures'
import {
  coverageThresholdFor,
  DEFAULT_COVERAGE_FLOOR,
  evaluateQualityGateV3,
  isConceptRich,
  TRANSCRIPT_COVERAGE_FLOOR,
} from './quality-gate.util'
import type { CoverageBlockV3 } from './v3-coverage.util'

describe('v3 quality gate (DET-343 acceptance criteria)', () => {
  it('applies the 80% floor to transcript lessons and 70% otherwise', () => {
    expect(coverageThresholdFor('transcript_lesson')).toBe(
      TRANSCRIPT_COVERAGE_FLOOR,
    )
    expect(coverageThresholdFor('structured_web_article')).toBe(
      DEFAULT_COVERAGE_FLOOR,
    )
    expect(coverageThresholdFor('unknown')).toBe(DEFAULT_COVERAGE_FLOOR)
  })

  it('passes a well-grounded structured article (>=70% coverage, prompts, no unsupported claims)', () => {
    const article = makeV3Article({ sourceKind: 'structured_web_article' })
    const { status, qualityReport } = evaluateQualityGateV3(
      article,
      makeBlocks(),
    )
    expect(status).toBe('READY_FOR_REVIEW')
    expect(qualityReport.importantSourceCoverageScore).toBe(100)
    expect(qualityReport.unsupportedClaimCount).toBe(0)
    expect(qualityReport.blockerReasons).toHaveLength(0)
  })

  it('BLOCKS a transcript whose important coverage is below 80%', () => {
    // Three important blocks, only one represented ⇒ 33% < 80%.
    const blocks: CoverageBlockV3[] = [
      { id: 'b1', classification: 'DEFINITION', removable: false },
      { id: 'b2', classification: 'MAIN_ARGUMENT', removable: false },
      { id: 'b3', classification: 'EVIDENCE', removable: false },
    ]
    const article = makeV3Article({ sourceKind: 'transcript_lesson' })
    const { status, qualityReport } = evaluateQualityGateV3(article, blocks)
    expect(status).toBe('BLOCKED_LOW_COVERAGE')
    expect(qualityReport.importantSourceCoverageScore).toBe(33)
    const lowCoverage = qualityReport.blockerReasons.find(
      (b) => b.code === 'low_coverage',
    )
    expect(lowCoverage).toBeDefined()
    // AC5: each blocker points at the quality-report entry that justifies it.
    expect(lowCoverage?.qualityReportRef).toBe('importantSourceCoverageScore')
    expect(qualityReport.regenerationHints.length).toBeGreaterThan(0)
  })

  it('BLOCKS any article with an unsupported claim (must be 0 for READY)', () => {
    const article = makeV3Article({
      keyClaims: [
        {
          id: 'claim-0',
          text: 'An unsupported assertion.',
          sourceBlockIds: [],
          articleSectionIds: [],
          claimType: 'definition',
          confidence: 0.5,
        },
      ],
    })
    const { status, qualityReport } = evaluateQualityGateV3(
      article,
      makeBlocks(),
    )
    expect(status).toBe('BLOCKED_UNSUPPORTED_CLAIMS')
    expect(qualityReport.unsupportedClaimCount).toBe(1)
  })

  it('unsupported claims outrank low coverage in the held-back status', () => {
    const blocks: CoverageBlockV3[] = [
      { id: 'b1', classification: 'DEFINITION', removable: false },
      { id: 'b2', classification: 'MAIN_ARGUMENT', removable: false },
      { id: 'b3', classification: 'EVIDENCE', removable: false },
    ]
    const article = makeV3Article({
      sourceKind: 'transcript_lesson',
      keyClaims: [
        {
          id: 'claim-0',
          text: 'Unsupported.',
          sourceBlockIds: [],
          articleSectionIds: [],
          claimType: 'definition',
          confidence: 0.5,
        },
      ],
    })
    expect(evaluateQualityGateV3(article, blocks).status).toBe(
      'BLOCKED_UNSUPPORTED_CLAIMS',
    )
  })

  it('BLOCKS a concept-rich source that yields zero concept candidates', () => {
    const article = makeV3Article({ keyConcepts: [] })
    // b1 is a DEFINITION ⇒ concept-bearing ⇒ concepts are required.
    const { status, qualityReport } = evaluateQualityGateV3(
      article,
      makeBlocks(),
    )
    expect(status).toBe('BLOCKED_MISSING_CONCEPTS')
    expect(
      qualityReport.blockerReasons.some((b) => b.code === 'missing_concepts'),
    ).toBe(true)
  })

  it('BLOCKS a concept-rich source with fewer than 3 concept candidates (minConceptCandidateCount)', () => {
    // Two concepts on a concept-rich (DEFINITION) source ⇒ below the floor of 3.
    const article = makeV3Article({
      keyConcepts: [
        {
          id: 'concept-0',
          name: 'A',
          normalizedName: 'a',
          type: 'core_concept',
          sourceBlockIds: ['b1'],
          articleSectionIds: ['sec-0'],
          importance: 'high',
          suggestedCognitiveState: 'Parsed',
        },
        {
          id: 'concept-1',
          name: 'B',
          normalizedName: 'b',
          type: 'core_concept',
          sourceBlockIds: ['b1'],
          articleSectionIds: ['sec-0'],
          importance: 'medium',
          suggestedCognitiveState: 'Parsed',
        },
      ],
    })
    const { status, qualityReport } = evaluateQualityGateV3(
      article,
      makeBlocks(),
    )
    expect(status).toBe('BLOCKED_MISSING_CONCEPTS')
    expect(qualityReport.conceptCandidateCount).toBe(2)
    expect(
      qualityReport.blockerReasons.some((b) => b.code === 'missing_concepts'),
    ).toBe(true)
  })

  it('PASSES a concept-rich source once it surfaces 3 concept candidates', () => {
    // The shared fixture default ships exactly 3 concepts ⇒ clears the floor.
    const { status } = evaluateQualityGateV3(makeV3Article(), makeBlocks())
    expect(status).toBe('READY_FOR_REVIEW')
  })

  it('does NOT require concepts from a source with no definition/example substance', () => {
    const blocks: CoverageBlockV3[] = [
      { id: 'b1', classification: 'METHOD', removable: false },
    ]
    expect(isConceptRich(blocks)).toBe(false)
    const article = makeV3Article({
      keyConcepts: [],
      sections: [
        {
          id: 'sec-0',
          heading: 'S',
          sourceBlockIds: ['b1'],
          paragraphs: [
            {
              id: 'sec-0-p-0',
              text: 'Step.',
              sourceBlockIds: ['b1'],
            },
          ],
        },
      ],
    })
    expect(evaluateQualityGateV3(article, blocks).status).toBe(
      'READY_FOR_REVIEW',
    )
  })

  it('holds back an article with no retrieval prompts (a learning artifact must ship them)', () => {
    // 3 concepts so the missing_concepts gate stays silent and the retrieval-prompt
    // blocker (NEEDS_REGENERATION) is the only one that fires.
    const article = makeV3Article({
      keyConcepts: [
        {
          id: 'concept-0',
          name: 'X',
          normalizedName: 'x',
          type: 'core_concept',
          sourceBlockIds: ['b1'],
          articleSectionIds: ['sec-0'],
          importance: 'high',
          suggestedCognitiveState: 'Parsed',
        },
        {
          id: 'concept-1',
          name: 'Y',
          normalizedName: 'y',
          type: 'core_concept',
          sourceBlockIds: ['b1'],
          articleSectionIds: ['sec-0'],
          importance: 'medium',
          suggestedCognitiveState: 'Parsed',
        },
        {
          id: 'concept-2',
          name: 'Z',
          normalizedName: 'z',
          type: 'core_concept',
          sourceBlockIds: ['b1'],
          articleSectionIds: ['sec-0'],
          importance: 'medium',
          suggestedCognitiveState: 'Parsed',
        },
      ],
      retrievalPrompts: [],
    })
    const { status, qualityReport } = evaluateQualityGateV3(
      article,
      makeBlocks(),
    )
    expect(status).toBe('NEEDS_REGENERATION')
    expect(qualityReport.retrievalPromptCount).toBe(0)
  })

  it('reports raw and important coverage + a populated quality report', () => {
    const { qualityReport } = evaluateQualityGateV3(
      makeV3Article(),
      makeBlocks(),
    )
    expect(qualityReport.retrievalPromptCount).toBe(1)
    expect(qualityReport.provenanceCompletenessScore).toBe(100)
    expect(qualityReport.sourceCoverageScore).toBe(100)
  })
})
