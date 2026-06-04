import { mergeDeterministicChecks } from './fidelity-checker.service'
import { FidelityReportSchema } from './schemas'
import type {
  FidelityReport,
  SourcePreservingArticle,
} from './transformer.types'

function emptyReport(score: number): FidelityReport {
  return {
    fidelityScore: score,
    approved: true, // model says approved; code must recompute
    addedInformation: [],
    lostInformation: [],
    meaningChanges: [],
    unsupportedHeadings: [],
    missingCaveats: [],
    unsupportedExamples: [],
    emphasisChanges: [],
    structuralFindings: [],
  }
}

function article(
  partial: Partial<SourcePreservingArticle> = {},
): SourcePreservingArticle {
  return {
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [
      {
        id: 'p1',
        text: 'x',
        sourceBlockIds: ['b1'],
        transformationType: 'verbatim',
        fidelityRisk: 'low',
      },
    ],
    sections: [],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    ...partial,
  }
}

const known = new Set(['b1', 'b2'])

describe('mergeDeterministicChecks (fidelity blocking rules)', () => {
  it('approves: score 95 + no high findings + full traceability', () => {
    const out = mergeDeterministicChecks(emptyReport(95), article(), known)
    expect(out.approved).toBe(true)
  })

  it('blocks: score 94 even with no findings', () => {
    const out = mergeDeterministicChecks(emptyReport(94), article(), known)
    expect(out.approved).toBe(false)
  })

  it('blocks: a high-severity addedInformation finding', () => {
    const report = emptyReport(99)
    report.addedInformation.push({ severity: 'high', description: 'new fact' })
    const out = mergeDeterministicChecks(report, article(), known)
    expect(out.approved).toBe(false)
  })

  it('blocks: a high-severity lostInformation finding', () => {
    const report = emptyReport(99)
    report.lostInformation.push({
      severity: 'high',
      description: 'dropped caveat',
    })
    const out = mergeDeterministicChecks(report, article(), known)
    expect(out.approved).toBe(false)
  })

  it('blocks + adds a finding: paragraph with an unknown blockId', () => {
    const out = mergeDeterministicChecks(
      emptyReport(99),
      article({
        abstract: [
          {
            id: 'p1',
            text: 'x',
            sourceBlockIds: ['ghost'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
      }),
      known,
    )
    expect(out.approved).toBe(false)
    expect(
      out.lostInformation.some((f) => f.description.includes('unknown block')),
    ).toBe(true)
  })

  it('blocks + records unsupportedHeading: inferred heading with empty section sourceBlockIds', () => {
    const out = mergeDeterministicChecks(
      emptyReport(99),
      article({
        sections: [
          {
            id: 's1',
            heading: 'Inferred',
            headingSource: 'inferred_from_source',
            sourceBlockIds: [],
            paragraphs: [
              {
                id: 'p2',
                text: 'y',
                sourceBlockIds: ['b1'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      }),
      known,
    )
    expect(out.approved).toBe(false)
    expect(out.unsupportedHeadings.length).toBeGreaterThan(0)
  })

  it('always recomputes approved, ignoring the model-provided value', () => {
    const report = emptyReport(50) // model claims approved:true but score is 50
    const out = mergeDeterministicChecks(report, article(), known)
    expect(out.approved).toBe(false)
  })

  // --- DET-281: new finding groups block approval ---------------------------

  it('blocks: a high-severity emphasisChanges finding (DET-281)', () => {
    const report = emptyReport(99)
    report.emphasisChanges.push({
      severity: 'high',
      description: 'reading order inverts a chronological source',
    })
    const out = mergeDeterministicChecks(report, article(), known)
    expect(out.approved).toBe(false)
  })

  it('blocks: a high-severity structuralFindings finding (DET-281)', () => {
    const report = emptyReport(99)
    report.structuralFindings.push({
      severity: 'high',
      description: 'caveat separated from its claim',
    })
    const out = mergeDeterministicChecks(report, article(), known)
    expect(out.approved).toBe(false)
  })

  it('does NOT block on a medium-severity structuralFindings finding', () => {
    const report = emptyReport(99)
    report.structuralFindings.push({
      severity: 'medium',
      description: 'a soft heuristic finding',
    })
    const out = mergeDeterministicChecks(report, article(), known)
    expect(out.approved).toBe(true)
  })

  it('old stored report shape (no emphasis/structural fields) still parses via schema defaults', () => {
    // An old stored fidelityReport JSON predates DET-281 — it has none of the
    // two new groups. The schema `.default([])` must fill them in on re-read.
    const stored = {
      fidelityScore: 98,
      approved: true,
      addedInformation: [],
      lostInformation: [],
      meaningChanges: [],
      unsupportedHeadings: [],
      missingCaveats: [],
      unsupportedExamples: [],
    }
    const parsed = FidelityReportSchema.parse(stored)
    expect(parsed.emphasisChanges).toEqual([])
    expect(parsed.structuralFindings).toEqual([])
  })
})
