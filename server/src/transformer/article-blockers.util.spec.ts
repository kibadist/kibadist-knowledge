import {
  deriveBlockers,
  highImportanceUnrepresented,
  isConceptRichSource,
  LOW_COVERAGE_PERCENT,
  MIN_CONCEPT_CANDIDATES,
} from './article-blockers.util'
import type {
  ConceptualSegmentation,
  CoverageReport,
  FidelityFinding,
  FidelityReport,
} from './transformer.types'

function okFidelity(over: Partial<FidelityReport> = {}): FidelityReport {
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
    ...over,
  }
}

function okCoverage(over: Partial<CoverageReport> = {}): CoverageReport {
  return {
    totalBlocks: 10,
    coveragePercent: 100,
    representedBlockIds: [],
    removedBlocks: [],
    uncertainBlockIds: [],
    unrepresentedBlockIds: [],
    paragraphMap: [],
    ...over,
  }
}

const highFinding: FidelityFinding = {
  severity: 'high',
  description: 'Article asserts X which the source never states.',
  articleRef: 'sp9',
  sourceBlockIds: ['b9'],
}

describe('isConceptRichSource', () => {
  it('classifies the teachable source kinds as concept-rich', () => {
    expect(isConceptRichSource('transcript_lesson')).toBe(true)
    expect(isConceptRichSource('structured_web_article')).toBe(true)
    expect(isConceptRichSource('research_paper')).toBe(true)
    expect(isConceptRichSource('documentation')).toBe(true)
    expect(isConceptRichSource('raw_notes')).toBe(false)
    expect(isConceptRichSource('unknown')).toBe(false)
  })
})

describe('highImportanceUnrepresented', () => {
  const segmentation: ConceptualSegmentation = {
    segments: [
      {
        id: 'seg-0',
        title: 'Key idea',
        role: 'orientation',
        sourceBlockIds: ['b1', 'b2'],
        importance: 'high',
        summary: 's',
        mustPreserveClaims: [],
        suggestedArticlePlacement: 'main_body',
      },
      {
        id: 'seg-1',
        title: 'Aside',
        role: 'example',
        sourceBlockIds: ['b3'],
        importance: 'low',
        summary: 's',
        mustPreserveClaims: [],
        suggestedArticlePlacement: 'main_body',
      },
    ],
    unsegmentedBlocks: [],
    warnings: [],
  }

  it('returns high-importance segment blocks that are unrepresented', () => {
    const coverage = okCoverage({ unrepresentedBlockIds: ['b2', 'b3'] })
    // b2 is high-importance + unrepresented; b3 is low-importance ⇒ excluded.
    expect(highImportanceUnrepresented(segmentation, coverage)).toEqual(['b2'])
  })

  it('returns [] when there is no segmentation', () => {
    expect(
      highImportanceUnrepresented(
        null,
        okCoverage({ unrepresentedBlockIds: ['b2'] }),
      ),
    ).toEqual([])
  })
})

describe('deriveBlockers', () => {
  const base = {
    conceptCandidateCount: 5,
    sourceKind: 'structured_web_article' as const,
    segmentation: null,
  }

  it('returns no blockers for an approved article', () => {
    expect(
      deriveBlockers({
        ...base,
        fidelity: okFidelity(),
        coverage: okCoverage(),
      }),
    ).toEqual([])
  })

  it('flags low_coverage when the percent is below the floor', () => {
    const blockers = deriveBlockers({
      ...base,
      fidelity: okFidelity(),
      coverage: okCoverage({
        coveragePercent: LOW_COVERAGE_PERCENT - 10,
        unrepresentedBlockIds: ['b4', 'b5'],
      }),
    })
    const lc = blockers.find((b) => b.reason === 'low_coverage')
    expect(lc).toBeDefined()
    expect(lc?.evidence.sourceBlockIds).toEqual(['b4', 'b5'])
  })

  it('flags low_coverage (high severity) on a high-importance miss even at good percent', () => {
    const blockers = deriveBlockers({
      ...base,
      fidelity: okFidelity(),
      coverage: okCoverage({ coveragePercent: 99 }),
      highImportanceUnrepresented: ['b7'],
    })
    const lc = blockers.find((b) => b.reason === 'low_coverage')
    expect(lc?.severity).toBe('high')
    expect(lc?.evidence.sourceBlockIds).toEqual(['b7'])
  })

  it('flags unsupported_claims from added information / unsupported examples', () => {
    const blockers = deriveBlockers({
      ...base,
      fidelity: okFidelity({ addedInformation: [highFinding] }),
      coverage: okCoverage(),
    })
    const uc = blockers.find((b) => b.reason === 'unsupported_claims')
    expect(uc).toBeDefined()
    expect(uc?.severity).toBe('high')
    expect(uc?.evidence.articleRefs).toContain('sp9')
  })

  it('flags missing_concepts only on concept-rich sources below the minimum', () => {
    const blocked = deriveBlockers({
      ...base,
      conceptCandidateCount: MIN_CONCEPT_CANDIDATES - 1,
      fidelity: okFidelity(),
      coverage: okCoverage(),
    })
    expect(blocked.some((b) => b.reason === 'missing_concepts')).toBe(true)

    // Same low count, but a non-concept-rich source ⇒ never blocked on concepts.
    const notBlocked = deriveBlockers({
      ...base,
      sourceKind: 'raw_notes',
      conceptCandidateCount: 0,
      fidelity: okFidelity(),
      coverage: okCoverage(),
    })
    expect(notBlocked.some((b) => b.reason === 'missing_concepts')).toBe(false)
  })

  it('treats a null concept count on a concept-rich source as a high blocker', () => {
    const blockers = deriveBlockers({
      ...base,
      conceptCandidateCount: null,
      fidelity: okFidelity(),
      coverage: okCoverage(),
    })
    const mc = blockers.find((b) => b.reason === 'missing_concepts')
    expect(mc?.severity).toBe('high')
  })

  it('flags poor_transcript_coherence when a transcript has no segmentation', () => {
    const blockers = deriveBlockers({
      ...base,
      sourceKind: 'transcript_lesson',
      segmentation: null,
      fidelity: okFidelity(),
      coverage: okCoverage(),
    })
    const tc = blockers.find((b) => b.reason === 'poor_transcript_coherence')
    expect(tc?.severity).toBe('high')
  })

  it('flags poor_transcript_coherence on cluster-separation structural findings', () => {
    const blockers = deriveBlockers({
      ...base,
      sourceKind: 'transcript_lesson',
      segmentation: { segments: [], unsegmentedBlocks: [], warnings: [] },
      fidelity: okFidelity({
        structuralFindings: [
          {
            severity: 'high',
            description: 'Claim and its evidence cluster were separated.',
            articleRef: 's2',
          },
        ],
      }),
      coverage: okCoverage(),
    })
    expect(blockers.some((b) => b.reason === 'poor_transcript_coherence')).toBe(
      true,
    )
  })

  it('does not flag transcript coherence for a healthy transcript', () => {
    const blockers = deriveBlockers({
      ...base,
      sourceKind: 'transcript_lesson',
      segmentation: {
        segments: [
          {
            id: 'seg-0',
            title: 't',
            role: 'orientation',
            sourceBlockIds: ['b1'],
            importance: 'high',
            summary: 's',
            mustPreserveClaims: [],
            suggestedArticlePlacement: 'main_body',
          },
        ],
        unsegmentedBlocks: [],
        warnings: [],
      },
      fidelity: okFidelity(),
      coverage: okCoverage(),
    })
    expect(blockers.some((b) => b.reason === 'poor_transcript_coherence')).toBe(
      false,
    )
  })
})
