import {
  preserveValidSections,
  removeUnsupportedClaims,
  strategyFor,
} from './article-regeneration.util'
import type {
  ArticleBlockerReason,
  ArticleJsonV2,
  ArticleSectionV2,
} from './transformer.types'

function paragraph(id: string, sourceBlockIds: string[]) {
  return {
    id,
    type: 'paragraph' as const,
    text: 'x',
    sourceBlockIds,
    transformationType: 'verbatim' as const,
    fidelityRisk: 'low' as const,
  }
}

function section(
  id: string,
  blocks: ReturnType<typeof paragraph>[],
  over: Partial<ArticleSectionV2> = {},
): ArticleSectionV2 {
  return {
    id,
    heading: id,
    headingSource: 'original',
    sourceBlockIds: ['b1'],
    blocks,
    ...over,
  }
}

function article(
  sections: ArticleSectionV2[],
  over: Partial<ArticleJsonV2> = {},
): ArticleJsonV2 {
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
    ...over,
  }
}

describe('strategyFor', () => {
  const reasons: ArticleBlockerReason[] = [
    'low_coverage',
    'unsupported_claims',
    'missing_concepts',
    'poor_transcript_coherence',
  ]

  it('returns a non-empty strategy for every blocker reason', () => {
    for (const reason of reasons) {
      const strategy = strategyFor(reason)
      expect(strategy.stages.length).toBeGreaterThan(0)
      expect(strategy.why.length).toBeGreaterThan(0)
    }
  })

  it('maps each reason to the right stages', () => {
    expect(strategyFor('low_coverage').stages).toEqual([
      'reshaping_plan',
      'generation',
    ])
    expect(strategyFor('unsupported_claims').stages).toEqual(['claim_pruning'])
    expect(strategyFor('missing_concepts').stages).toEqual([
      'learning_extraction',
    ])
    expect(strategyFor('poor_transcript_coherence').stages).toEqual([
      'conceptual_segmentation',
      'reshaping_plan',
      'generation',
    ])
  })
})

describe('removeUnsupportedClaims', () => {
  it('removes blocks named in refsToRemove and untraceable blocks', () => {
    const input = article([
      section('s1', [
        paragraph('p-good', ['b1']),
        paragraph('p-flagged', ['b2']),
        paragraph('p-untraceable', []),
      ]),
    ])
    const { article: out, removedRefs } = removeUnsupportedClaims(input, [
      'p-flagged',
    ])
    expect(out.sections[0].blocks.map((b) => b.id)).toEqual(['p-good'])
    expect(removedRefs).toEqual(
      expect.arrayContaining(['p-flagged', 'p-untraceable']),
    )
  })

  it('drops a section that loses all its blocks', () => {
    const input = article([
      section('s1', [paragraph('p1', ['b1'])]),
      section('s2', [paragraph('p2', [])]),
    ])
    const { article: out, removedRefs } = removeUnsupportedClaims(input, [])
    expect(out.sections.map((s) => s.id)).toEqual(['s1'])
    expect(removedRefs).toContain('s2')
  })

  it('keeps a parent section alive when a subsection survives', () => {
    const input = article([
      section('s1', [paragraph('p1', [])], {
        subsections: [section('s1a', [paragraph('p2', ['b1'])])],
      }),
    ])
    const { article: out } = removeUnsupportedClaims(input, [])
    expect(out.sections.map((s) => s.id)).toEqual(['s1'])
    expect(out.sections[0].blocks).toEqual([])
    expect(out.sections[0].subsections?.[0].id).toBe('s1a')
  })

  it('prunes ungrounded end-matter and extras', () => {
    const input = article([section('s1', [paragraph('p1', ['b1'])])], {
      keyTerms: [
        { term: 'grounded', sourceBlockIds: ['b1'] },
        { term: 'ungrounded', sourceBlockIds: [] },
      ],
      sourceExamples: [{ text: 'e', sourceBlockIds: [] }],
      caveats: [{ text: 'c', sourceBlockIds: ['b1'] }],
      tables: [
        {
          id: 'gtbl-0',
          title: 'grounded',
          columns: ['a', 'b'],
          rows: [],
          sourceBlockIds: ['b1'],
          relatedSectionIds: [],
          fidelityRisk: 'low',
        },
        {
          id: 'gtbl-1',
          title: 'ungrounded',
          columns: ['a', 'b'],
          rows: [],
          sourceBlockIds: [],
          relatedSectionIds: [],
          fidelityRisk: 'low',
        },
      ],
      calloutPlacements: {
        bySection: {},
        unplaced: [],
        generated: [
          {
            id: 'gco-0',
            type: 'definition',
            title: 'grounded',
            body: 'b',
            sourceBlockIds: ['b1'],
            relatedSectionIds: [],
            fidelityRisk: 'low',
          },
          {
            id: 'gco-1',
            type: 'definition',
            title: 'ungrounded',
            body: 'b',
            sourceBlockIds: [],
            relatedSectionIds: [],
            fidelityRisk: 'low',
          },
        ],
      },
    })
    const { article: out } = removeUnsupportedClaims(input, [])
    expect(out.keyTerms.map((k) => k.term)).toEqual(['grounded'])
    expect(out.sourceExamples).toEqual([])
    expect(out.caveats).toHaveLength(1)
    expect(out.tables?.map((t) => t.id)).toEqual(['gtbl-0'])
    expect(out.calloutPlacements?.generated?.map((c) => c.id)).toEqual([
      'gco-0',
    ])
  })
})

describe('preserveValidSections', () => {
  it('preserves prior sections that are not invalid', () => {
    const prior = [section('s1', [paragraph('p1', ['b1'])])]
    const regenerated = [section('s1', [paragraph('p1-new', ['b1'])])]
    const { sections, preservedSectionIds } = preserveValidSections(
      prior,
      regenerated,
      [],
    )
    expect(preservedSectionIds).toEqual(['s1'])
    expect(sections[0].blocks[0].id).toBe('p1') // prior kept verbatim
  })

  it('replaces an invalid section with the regenerated same-id section', () => {
    const prior = [section('s1', [paragraph('p1', ['b1'])])]
    const regenerated = [section('s1', [paragraph('p1-new', ['b1'])])]
    const { sections, preservedSectionIds } = preserveValidSections(
      prior,
      regenerated,
      ['s1'],
    )
    expect(preservedSectionIds).toEqual([])
    expect(sections[0].blocks[0].id).toBe('p1-new')
  })

  it('drops an invalid section with no regenerated replacement', () => {
    const prior = [
      section('s1', [paragraph('p1', ['b1'])]),
      section('s2', [paragraph('p2', ['b2'])]),
    ]
    const { sections } = preserveValidSections(prior, [], ['s2'])
    expect(sections.map((s) => s.id)).toEqual(['s1'])
  })

  it('appends regenerated sections that fill new gaps', () => {
    const prior = [section('s1', [paragraph('p1', ['b1'])])]
    const regenerated = [section('s2', [paragraph('p2', ['b2'])])]
    const { sections, preservedSectionIds } = preserveValidSections(
      prior,
      regenerated,
      [],
    )
    expect(sections.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(preservedSectionIds).toEqual(['s1'])
  })
})
