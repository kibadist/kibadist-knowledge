import { toArticleV2 } from './article-compat.util'
import { buildCoverageReport } from './coverage.util'
import type {
  ArticleJsonV2,
  SourcePreservingArticle,
} from './transformer.types'

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
    // Buckets are disjoint: b3 lives in the uncertain bucket only (it still
    // counts against coveragePercent — uncited uncertain IS a coverage miss).
    expect(report.unrepresentedBlockIds).toEqual([])
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

describe('buildCoverageReport on v2 articles (DET-277)', () => {
  const blocks = [
    { id: 'b1', uncertain: false },
    { id: 'b2', uncertain: false },
    { id: 'b3', uncertain: false },
    { id: 'b4', uncertain: false },
  ]

  it('represents native v2 blocks and recurses into subsections', () => {
    const v2: ArticleJsonV2 = {
      schemaVersion: 'v2',
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections: [
        {
          id: 's1',
          heading: 'H',
          headingSource: 'original',
          sourceBlockIds: [],
          blocks: [
            {
              id: 'l1',
              type: 'list',
              ordered: false,
              items: ['x'],
              sourceBlockIds: ['b1'],
              transformationType: 'formatting_only',
              fidelityRisk: 'low',
            },
            {
              id: 'q1',
              type: 'quote',
              text: 'q',
              sourceBlockIds: ['b2'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
            },
          ],
          subsections: [
            {
              id: 's1a',
              heading: 'Nested',
              headingSource: 'inferred',
              sourceBlockIds: [],
              blocks: [
                {
                  id: 'p1',
                  type: 'paragraph',
                  text: 'p',
                  sourceBlockIds: ['b3'],
                  transformationType: 'verbatim',
                  fidelityRisk: 'low',
                },
              ],
            },
          ],
        },
      ],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
    }
    const report = buildCoverageReport(v2, blocks, [])
    expect(report.representedBlockIds.sort()).toEqual(['b1', 'b2', 'b3'])
    expect(report.unrepresentedBlockIds).toEqual(['b4'])
    // paragraphMap covers every block (list, quote, nested paragraph) in order.
    expect(report.paragraphMap.map((m) => m.paragraphId)).toEqual([
      'l1',
      'q1',
      'p1',
    ])
  })

  it('adapting v1 → v2 gives an identical coverage report to passing v1 directly', () => {
    const v1: SourcePreservingArticle = {
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [
        {
          id: 'a1',
          text: 'a',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
      sections: [
        {
          id: 's1',
          heading: 'H',
          headingSource: 'original',
          sourceBlockIds: ['b2'],
          paragraphs: [
            {
              id: 'p1',
              text: 'p',
              sourceBlockIds: ['b3'],
              transformationType: 'light_reword',
              fidelityRisk: 'medium',
            },
          ],
        },
      ],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
    }
    const fromV1 = buildCoverageReport(v1, blocks, [])
    const fromV2 = buildCoverageReport(toArticleV2(v1), blocks, [])
    expect(fromV2).toEqual(fromV1)
  })
})

describe('buildCoverageReport — reorderAudit summary (DET-275)', () => {
  function v2(sections: ArticleJsonV2['sections']): ArticleJsonV2 {
    return {
      schemaVersion: 'v2',
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'original' },
      abstract: [],
      sections,
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
      originalStructure: [],
    }
  }
  const para = (id: string, ids: string[]) => ({
    id,
    type: 'paragraph' as const,
    text: id,
    sourceBlockIds: ids,
    transformationType: 'verbatim' as const,
    fidelityRisk: 'low' as const,
  })
  const sec = (id: string, ids: string[]) => ({
    id,
    heading: id,
    headingSource: 'inferred' as const,
    sourceBlockIds: ids,
    blocks: [para(`${id}-p`, ids)],
  })
  const blocks = [
    { id: 'b1', uncertain: false },
    { id: 'b2', uncertain: false },
    { id: 'b3', uncertain: false },
  ]

  it('reports audited=0, unaudited=0 when reading order matches source order', () => {
    const report = buildCoverageReport(
      v2([sec('s1', ['b1']), sec('s2', ['b2']), sec('s3', ['b3'])]),
      blocks,
      [],
    )
    expect(report.reorderAudit).toEqual({ audited: 0, unaudited: 0 })
  })

  it('counts an unaudited move when a section moves without an audit entry', () => {
    // b3 jumps to the front with no reorderings → one unaudited move.
    const report = buildCoverageReport(
      v2([sec('s3', ['b3']), sec('s1', ['b1']), sec('s2', ['b2'])]),
      blocks,
      [],
    )
    expect(report.reorderAudit?.unaudited).toBe(1)
    expect(report.reorderAudit?.audited).toBe(0)
  })

  it('counts a covered move as audited with zero unaudited', () => {
    const article = v2([sec('s3', ['b3']), sec('s1', ['b1']), sec('s2', ['b2'])])
    article.reorderings = [
      {
        sourceBlockId: 'b3',
        fromIndex: 2,
        toIndex: 0,
        reason: 'moved up',
        risk: 'low',
      },
    ]
    const report = buildCoverageReport(article, blocks, [])
    expect(report.reorderAudit).toEqual({ audited: 1, unaudited: 0 })
  })
})
