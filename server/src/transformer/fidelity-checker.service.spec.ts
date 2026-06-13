import { reorderFixtures } from './__fixtures__'
import { knownBlockIds } from './__fixtures__/index'
import { mergeDeterministicChecks } from './fidelity-checker.service'
import { FidelityReportSchema } from './schemas'
import type {
  ArticleJsonV2,
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

  // --- DET-275 audited reorder ----------------------------------------------

  it('blocks: unaudited movement → high structuralFinding', () => {
    const { article, blocks, structureModel } =
      reorderFixtures.unauditedMovement
    const out = mergeDeterministicChecks(
      emptyReport(99),
      article,
      knownBlockIds(blocks),
      { structureModel, blocks },
    )
    const finding = out.structuralFindings.find(
      (f) => f.severity === 'high' && /unaudited reorder/i.test(f.description),
    )
    expect(finding).toBeDefined()
    expect(out.approved).toBe(false)
  })

  it('approves: a fully-audited, cluster-safe reorder', () => {
    const { article, blocks, structureModel } = reorderFixtures.safeReorder
    const out = mergeDeterministicChecks(
      emptyReport(99),
      article,
      knownBlockIds(blocks),
      { structureModel, blocks },
    )
    // No unaudited movement, no cluster separation, no chronology inversion.
    expect(
      out.structuralFindings.some((f) =>
        /unaudited reorder/i.test(f.description),
      ),
    ).toBe(false)
    expect(out.approved).toBe(true)
  })

  it('audited HIGH-risk move surfaces a medium emphasisChanges note (non-blocking by itself)', () => {
    const { article, blocks, structureModel } = reorderFixtures.safeReorder
    // Re-stamp the safe article with a high-risk audit entry; it must surface a
    // medium emphasisChanges finding without blocking (no high finding).
    const highRisk = {
      ...article,
      reorderings: (article.reorderings ?? []).map((r) => ({
        ...r,
        risk: 'high' as const,
      })),
    }
    const out = mergeDeterministicChecks(
      emptyReport(99),
      highRisk,
      knownBlockIds(blocks),
      { structureModel, blocks },
    )
    const note = out.emphasisChanges.find(
      (f) =>
        f.severity === 'medium' && /high-risk reorder/i.test(f.description),
    )
    expect(note).toBeDefined()
    // The high-risk audit alone does not block (still cluster/chronology-safe).
    expect(out.approved).toBe(true)
  })

  it('blocks: an audited-but-unsafe reorder (cluster separation still wins)', () => {
    const { article, blocks, structureModel } = reorderFixtures.unsafeReorder
    const out = mergeDeterministicChecks(
      emptyReport(99),
      article,
      knownBlockIds(blocks),
      { structureModel, blocks },
    )
    // The move is fully audited → no unaudited-movement finding…
    expect(
      out.structuralFindings.some((f) =>
        /unaudited reorder/i.test(f.description),
      ),
    ).toBe(false)
    // …yet the cluster check still blocks (caveat separated from its claim).
    expect(
      out.structuralFindings.some(
        (f) =>
          f.severity === 'high' &&
          /separated from the claim/.test(f.description),
      ),
    ).toBe(true)
    expect(out.approved).toBe(false)
  })

  // --- DET-352 key-claim traceability --------------------------------------

  function v2WithClaims(keyClaims: ArticleJsonV2['keyClaims']): ArticleJsonV2 {
    return {
      schemaVersion: 'v2',
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
      sections: [
        {
          id: 's1',
          heading: 'S',
          headingSource: 'original',
          sourceBlockIds: ['b1'],
          blocks: [
            {
              id: 'sb1',
              type: 'paragraph',
              text: 'x',
              sourceBlockIds: ['b1'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
            },
          ],
        },
      ],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
      keyClaims,
    }
  }

  it('approves: a fully traceable key claim', () => {
    const out = mergeDeterministicChecks(
      emptyReport(99),
      v2WithClaims([
        {
          id: 'k1',
          text: 'a claim',
          sourceBlockIds: ['b1'],
          articleSectionIds: ['s1'],
          claimType: 'definition',
          confidence: 0.9,
        },
      ]),
      known,
    )
    expect(out.approved).toBe(true)
  })

  it('blocks: a key claim citing an unknown source block', () => {
    const out = mergeDeterministicChecks(
      emptyReport(99),
      v2WithClaims([
        {
          id: 'k1',
          text: 'a claim',
          sourceBlockIds: ['ghost'],
          articleSectionIds: ['s1'],
          claimType: 'mechanism',
          confidence: 0.9,
        },
      ]),
      known,
    )
    expect(out.approved).toBe(false)
    expect(
      out.structuralFindings.some(
        (f) => f.severity === 'high' && /Key claim/.test(f.description),
      ),
    ).toBe(true)
  })

  it('blocks: a key claim referencing an unknown article section', () => {
    const out = mergeDeterministicChecks(
      emptyReport(99),
      v2WithClaims([
        {
          id: 'k1',
          text: 'a claim',
          sourceBlockIds: ['b1'],
          articleSectionIds: ['sGhost'],
          claimType: 'caveat',
          confidence: 0.9,
        },
      ]),
      known,
    )
    expect(out.approved).toBe(false)
    expect(
      out.structuralFindings.some(
        (f) =>
          f.severity === 'high' &&
          /unknown article section/.test(f.description),
      ),
    ).toBe(true)
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
