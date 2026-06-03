import { buildCoverageReport } from './coverage.util'
import type { SourcePreservingArticle } from './transformer.types'

function article(
  partial: Partial<SourcePreservingArticle> = {},
): SourcePreservingArticle {
  return {
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections: [],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    ...partial,
  }
}

describe('buildCoverageReport', () => {
  it('computes coveragePercent as represented / (total - removed), rounded', () => {
    // 4 blocks; b4 removed → denominator 3; b1,b2 represented → 2/3 = 67%.
    const report = buildCoverageReport(
      article({
        sections: [
          {
            id: 's1',
            heading: 'H',
            headingSource: 'original',
            sourceBlockIds: ['b1'],
            paragraphs: [
              {
                id: 'p1',
                text: 'x',
                sourceBlockIds: ['b1', 'b2'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      }),
      [
        { id: 'b1', uncertain: false },
        { id: 'b2', uncertain: false },
        { id: 'b3', uncertain: true },
        { id: 'b4', uncertain: false },
      ],
      [{ blockId: 'b4', reason: 'footer' }],
    )

    expect(report.totalBlocks).toBe(4)
    expect(report.coveragePercent).toBe(67)
    expect(report.representedBlockIds.sort()).toEqual(['b1', 'b2'])
    expect(report.removedBlocks).toEqual([{ blockId: 'b4', reason: 'footer' }])
    expect(report.uncertainBlockIds).toEqual(['b3'])
    // b3 is unrepresented (uncertain but not removed, not represented).
    expect(report.unrepresentedBlockIds).toEqual(['b3'])
  })

  it('paragraphMap covers abstract + all section paragraphs in order', () => {
    const report = buildCoverageReport(
      article({
        abstract: [
          {
            id: 'a1',
            text: 'abs',
            sourceBlockIds: ['b1'],
            transformationType: 'light_reword',
            fidelityRisk: 'low',
          },
        ],
        sections: [
          {
            id: 's1',
            heading: 'H',
            headingSource: 'original',
            sourceBlockIds: ['b1'],
            paragraphs: [
              {
                id: 'p1',
                text: 'x',
                sourceBlockIds: ['b1'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
              {
                id: 'p2',
                text: 'y',
                sourceBlockIds: ['b2'],
                transformationType: 'grammar_cleanup',
                fidelityRisk: 'medium',
              },
            ],
          },
        ],
      }),
      [
        { id: 'b1', uncertain: false },
        { id: 'b2', uncertain: false },
      ],
      [],
    )

    expect(report.paragraphMap.map((p) => p.paragraphId)).toEqual([
      'a1',
      'p1',
      'p2',
    ])
    expect(report.coveragePercent).toBe(100)
  })

  it('counts keyTerms/examples/caveats as representation', () => {
    const report = buildCoverageReport(
      article({
        keyTerms: [{ term: 'K', sourceBlockIds: ['b1'] }],
        sourceExamples: [{ text: 'E', sourceBlockIds: ['b2'] }],
        caveats: [{ text: 'C', sourceBlockIds: ['b3'] }],
      }),
      [
        { id: 'b1', uncertain: false },
        { id: 'b2', uncertain: false },
        { id: 'b3', uncertain: false },
      ],
      [],
    )
    expect(report.representedBlockIds.sort()).toEqual(['b1', 'b2', 'b3'])
    expect(report.unrepresentedBlockIds).toEqual([])
  })
})
