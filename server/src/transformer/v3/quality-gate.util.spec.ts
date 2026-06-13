import {
  coverageThresholdFor,
  DEFAULT_COVERAGE_FLOOR,
  evaluateQualityGate,
  isConceptRich,
  TRANSCRIPT_COVERAGE_FLOOR,
} from './quality-gate.util'
import {
  ARTICLE_SCHEMA_VERSION_V3,
  type ArticleJsonV3,
  type KeyClaim,
  type KeyConcept,
  type RetrievalPromptV3,
  type SourceKind,
} from './v3.types'
import type { CoverageBlockV3 } from './v3-coverage.util'

/**
 * Build a v3 article whose IMPORTANT-coverage comes out to a target percent: we
 * make `importantCount` important blocks and have the article cite `coveredCount`
 * of them. Lets each gate test dial coverage precisely.
 */
function scenario(opts: {
  sourceKind?: SourceKind
  importantClasses?: string[] // classifications of the important blocks
  coveredCount?: number // how many important blocks the article cites
  concepts?: number
  prompts?: number
  unsupportedClaims?: number
  groundedClaims?: number
}): { article: ArticleJsonV3; blocks: CoverageBlockV3[] } {
  const importantClasses = opts.importantClasses ?? [
    'DEFINITION',
    'EVIDENCE',
    'METHOD',
    'MAIN_ARGUMENT',
  ]
  const blocks: CoverageBlockV3[] = importantClasses.map((c, i) => ({
    id: `b${i}`,
    classification: c,
    removable: false,
  }))
  const coveredCount = opts.coveredCount ?? blocks.length
  const citedIds = blocks.slice(0, coveredCount).map((b) => b.id)

  const keyConcepts: KeyConcept[] = Array.from(
    { length: opts.concepts ?? 0 },
    (_, i) => ({
      id: `concept-${i}`,
      label: `C${i}`,
      definition: 'd',
      sourceBlockIds: ['b0'],
      aiAssisted: true as const,
    }),
  )
  const retrievalPrompts: RetrievalPromptV3[] = Array.from(
    { length: opts.prompts ?? 0 },
    (_, i) => ({ id: `prompt-${i}`, prompt: `p${i}`, sourceBlockIds: ['b0'] }),
  )
  const keyClaims: KeyClaim[] = [
    ...Array.from({ length: opts.groundedClaims ?? 0 }, (_, i) => ({
      id: `gc-${i}`,
      text: 'g',
      sourceBlockIds: ['b0'],
      support: 'grounded' as const,
    })),
    ...Array.from({ length: opts.unsupportedClaims ?? 0 }, (_, i) => ({
      id: `uc-${i}`,
      text: 'u',
      sourceBlockIds: [],
      support: 'unsupported' as const,
    })),
  ]

  const article: ArticleJsonV3 = {
    schemaVersion: ARTICLE_SCHEMA_VERSION_V3,
    sourceKind: opts.sourceKind ?? 'structured_article',
    shape: 'overview',
    title: { text: 'T', provenance: 'scaffold' },
    summary: { text: 'S', provenance: 'scaffold' },
    sections: [
      {
        id: 'sec-0',
        heading: 'H',
        headingProvenance: 'scaffold',
        sourceBlockIds: citedIds,
        blocks: citedIds.map((id, bi) => ({
          id: `sec-0-b-${bi}`,
          type: 'paragraph' as const,
          text: 't',
          sourceBlockIds: [id],
          provenance: 'source' as const,
          fidelityRisk: 'low' as const,
        })),
      },
    ],
    learning: {
      learningPath: [],
      keyConcepts,
      keyClaims,
      retrievalPrompts,
      sourceNotes: [],
    },
    provenance: {
      totalBlocks: citedIds.length,
      sourceGroundedBlocks: citedIds.length,
      scaffoldBlocks: 0,
      groundedPercent: 100,
    },
  }
  return { article, blocks }
}

describe('coverageThresholdFor (DET-343)', () => {
  it('uses the 80% floor for transcripts and 70% otherwise', () => {
    expect(coverageThresholdFor('transcript')).toBe(TRANSCRIPT_COVERAGE_FLOOR)
    expect(coverageThresholdFor('structured_article')).toBe(
      DEFAULT_COVERAGE_FLOOR,
    )
    expect(coverageThresholdFor('reference')).toBe(DEFAULT_COVERAGE_FLOOR)
  })
})

describe('isConceptRich (DET-343)', () => {
  it('is true when the source has definition/example substance', () => {
    expect(
      isConceptRich([
        { id: 'b', classification: 'DEFINITION', removable: false },
      ]),
    ).toBe(true)
  })
  it('is false for procedure-only / noise sources', () => {
    expect(
      isConceptRich([{ id: 'b', classification: 'METHOD', removable: false }]),
    ).toBe(false)
  })
})

describe('evaluateQualityGate (DET-343)', () => {
  it('passes a clean structured article (≥70% coverage, 0 unsupported, concepts + prompts)', () => {
    const { article, blocks } = scenario({
      sourceKind: 'structured_article',
      coveredCount: 4, // 4/4 = 100%
      concepts: 3,
      prompts: 3,
      groundedClaims: 2,
    })
    const report = evaluateQualityGate(article, blocks)
    expect(report.status).toBe('READY_FOR_REVIEW')
    expect(report.blockers.filter((b) => b.severity === 'hard')).toHaveLength(0)
  })

  it('BLOCKS the PRD transcript failure: 6% coverage, 0 concepts', () => {
    // 16 important blocks, 1 cited ≈ 6%.
    const { article, blocks } = scenario({
      sourceKind: 'transcript',
      importantClasses: Array.from({ length: 16 }, () => 'DEFINITION'),
      coveredCount: 1,
      concepts: 0,
      prompts: 1,
    })
    const report = evaluateQualityGate(article, blocks)
    expect(report.status).toBe('BLOCKED')
    expect(report.importantCoveragePercent).toBe(6)
    const codes = report.blockers.map((b) => b.code)
    expect(codes).toContain('IMPORTANT_COVERAGE_BELOW_THRESHOLD')
    expect(codes).toContain('NO_CONCEPT_CANDIDATES')
  })

  it('BLOCKS the PRD structured failure: 42% coverage', () => {
    // 12 important blocks, 5 cited ≈ 42%.
    const { article, blocks } = scenario({
      sourceKind: 'structured_article',
      importantClasses: Array.from({ length: 12 }, () => 'EVIDENCE'),
      coveredCount: 5,
      concepts: 2,
      prompts: 2,
    })
    const report = evaluateQualityGate(article, blocks)
    expect(report.status).toBe('BLOCKED')
    expect(report.importantCoveragePercent).toBe(42)
    expect(report.blockers.map((b) => b.code)).toContain(
      'IMPORTANT_COVERAGE_BELOW_THRESHOLD',
    )
  })

  it('BLOCKS when any unsupported claim survives, even with full coverage', () => {
    const { article, blocks } = scenario({
      coveredCount: 4,
      concepts: 2,
      prompts: 2,
      unsupportedClaims: 1,
    })
    const report = evaluateQualityGate(article, blocks)
    expect(report.status).toBe('BLOCKED')
    expect(report.unsupportedClaimCount).toBe(1)
    const unsupported = report.blockers.find(
      (b) => b.code === 'UNSUPPORTED_CLAIMS_PRESENT',
    )
    expect(unsupported?.refs).toEqual(['uc-0'])
  })

  it('BLOCKS a concept-rich source that produced zero concepts', () => {
    const { article, blocks } = scenario({
      importantClasses: ['DEFINITION', 'EXAMPLE'],
      coveredCount: 2,
      concepts: 0,
      prompts: 2,
    })
    const report = evaluateQualityGate(article, blocks)
    expect(report.status).toBe('BLOCKED')
    expect(report.blockers.map((b) => b.code)).toContain(
      'NO_CONCEPT_CANDIDATES',
    )
  })

  it('BLOCKS an article with no retrieval prompts', () => {
    const { article, blocks } = scenario({
      importantClasses: ['METHOD', 'MAIN_ARGUMENT'],
      coveredCount: 2,
      concepts: 0,
      prompts: 0,
    })
    const report = evaluateQualityGate(article, blocks)
    expect(report.blockers.map((b) => b.code)).toContain('NO_RETRIEVAL_PROMPTS')
  })

  it('flags low exercise readiness as a SOFT blocker without blocking on it alone', () => {
    // Pass every hard gate but keep the learning layer thin (1 prompt, 0 concepts,
    // non-concept-rich source) so readiness is low.
    const { article, blocks } = scenario({
      importantClasses: ['METHOD', 'MAIN_ARGUMENT'],
      coveredCount: 2,
      concepts: 0,
      prompts: 1,
    })
    const report = evaluateQualityGate(article, blocks)
    expect(report.status).toBe('READY_FOR_REVIEW')
    const soft = report.blockers.find(
      (b) => b.code === 'LOW_EXERCISE_READINESS',
    )
    expect(soft?.severity).toBe('soft')
  })
})
