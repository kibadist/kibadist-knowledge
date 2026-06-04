import {
  auditPlanReorderCoverage,
  auditReorderCoverage,
  type ReorderSourceBlock,
} from './reorder-audit.util'
import type {
  ArticleBlock,
  ArticleJsonV2,
  ArticleReorderingAudit,
  ArticleSectionV2,
} from './transformer.types'

/**
 * DET-275 reorder-audit util spec. Pure movement detection + audit coverage over
 * a v2 article (and the plan-shaped variant). Movement is computed from the
 * article's section order vs source order (min cited orderIndex anchors); the
 * audit covers a move via `sourceBlockId` or `movedWithClusterIds`.
 */

const blocks = (...ids: string[]): ReorderSourceBlock[] =>
  ids.map((id) => ({ id }))

const para = (id: string, ids: string[]): ArticleBlock => ({
  id,
  type: 'paragraph',
  text: id,
  sourceBlockIds: ids,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
})

function section(
  id: string,
  ids: string[],
  subsections?: ArticleSectionV2[],
): ArticleSectionV2 {
  return {
    id,
    heading: id,
    headingSource: 'inferred',
    sourceBlockIds: ids,
    blocks: [para(`${id}-p`, ids)],
    ...(subsections ? { subsections } : {}),
  }
}

function article(sections: ArticleSectionV2[]): ArticleJsonV2 {
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

const audit = (
  over: Partial<ArticleReorderingAudit> & { sourceBlockId: string },
): ArticleReorderingAudit => ({
  fromIndex: 0,
  toIndex: 0,
  reason: 'r',
  risk: 'low',
  ...over,
})

describe('auditReorderCoverage — movement detection', () => {
  it('reports no moves when reading order matches source order', () => {
    const a = article([
      section('s1', ['b1']),
      section('s2', ['b2']),
      section('s3', ['b3']),
    ])
    const out = auditReorderCoverage(a, blocks('b1', 'b2', 'b3'))
    expect(out.moved).toEqual([])
    expect(out.unaudited).toEqual([])
  })

  it('detects a fully inverted reading order (minimal-edit moved set)', () => {
    const a = article([
      section('s3', ['b3']),
      section('s2', ['b2']),
      section('s1', ['b1']),
    ])
    const out = auditReorderCoverage(a, blocks('b1', 'b2', 'b3'))
    // Minimal-edit interpretation keeps the longest in-order run (the last-read
    // section here) and reports the rest as moved — never the whole article.
    expect(out.moved.length).toBeGreaterThan(0)
    expect(out.moved.length).toBeLessThan(3)
  })

  it('reports only the section that JUMPED forward, not the ones it displaced', () => {
    // Background block b3 read FIRST though it is last in source; the other two
    // keep their relative order, so only the jumped section is "moved".
    const a = article([
      section('s3', ['b3']),
      section('s1', ['b1']),
      section('s2', ['b2']),
    ])
    const out = auditReorderCoverage(a, blocks('b1', 'b2', 'b3'))
    expect(out.moved.map((m) => m.sectionId)).toEqual(['s3'])
    expect(out.moved[0].anchorBlockId).toBe('b3')
  })

  it('anchors a section on the MIN source position of its cited blocks', () => {
    // sJ cites b3+b2 → its anchor is b2 (position 1, the MIN). It reads FIRST
    // though b2 is mid-source, so it is the moved section; sA (b1) is the spine.
    const a = article([section('sJ', ['b3', 'b2']), section('sA', ['b1'])])
    const out = auditReorderCoverage(a, blocks('b1', 'b2', 'b3'))
    const sJ = out.moved.find((m) => m.sectionId === 'sJ')
    expect(sJ?.anchorBlockId).toBe('b2')
    expect(sJ?.sourceAnchorPos).toBe(1)
  })

  it('flattens subsections into reading order', () => {
    // Parent s1 (b1) with subsection sub (b3, anchor 2); then s2 (b2, anchor 1).
    // Reading anchors: [0, 2, 1] → the subsection (b3) is the out-of-order one.
    const a = article([
      section('s1', ['b1'], [section('sub', ['b3'])]),
      section('s2', ['b2']),
    ])
    const out = auditReorderCoverage(a, blocks('b1', 'b2', 'b3'))
    expect(out.moved.map((m) => m.sectionId)).toEqual(['sub'])
    expect(out.moved[0].anchorBlockId).toBe('b3')
  })
})

describe('auditReorderCoverage — audit coverage', () => {
  // Background block b3 jumps to the front; the other two keep order → the single
  // moved section's anchor is b3.
  const jumped = () =>
    article([section('s3', ['b3']), section('s1', ['b1']), section('s2', ['b2'])])

  it('covers the move via sourceBlockId', () => {
    const out = auditReorderCoverage(jumped(), blocks('b1', 'b2', 'b3'), [
      audit({ sourceBlockId: 'b3', fromIndex: 2, toIndex: 0 }),
    ])
    expect(out.moved.map((m) => m.anchorBlockId)).toEqual(['b3'])
    expect(out.unaudited).toEqual([])
    expect(out.audited).toBe(1)
  })

  it('covers the move via movedWithClusterIds', () => {
    // The audit names a different anchor but lists b3 as a cluster member.
    const out = auditReorderCoverage(jumped(), blocks('b1', 'b2', 'b3'), [
      audit({
        sourceBlockId: 'bOther',
        fromIndex: 9,
        toIndex: 0,
        movedWithClusterIds: ['b3'],
      }),
    ])
    expect(out.unaudited).toEqual([])
  })

  it('reports an uncovered move as unaudited', () => {
    // The audit covers an unrelated block; the b3 move is not recorded.
    const out = auditReorderCoverage(jumped(), blocks('b1', 'b2', 'b3'), [
      audit({ sourceBlockId: 'b1', fromIndex: 0, toIndex: 0 }),
    ])
    expect(out.unaudited.map((m) => m.anchorBlockId)).toEqual(['b3'])
  })

  it('preserves the audited count regardless of risk levels', () => {
    const out = auditReorderCoverage(jumped(), blocks('b1', 'b2', 'b3'), [
      audit({ sourceBlockId: 'b3', fromIndex: 2, toIndex: 0, risk: 'high' }),
    ])
    expect(out.audited).toBe(1)
    expect(out.unaudited).toEqual([])
  })
})

describe('auditPlanReorderCoverage — plan-shaped variant', () => {
  it('detects an unaudited move and identifies the section by heading', () => {
    const plan = {
      sections: [
        { heading: 'Bananas', sourceBlockIds: ['b3'] },
        { heading: 'Apples', sourceBlockIds: ['b1'] },
      ],
      reorderings: [] as ArticleReorderingAudit[],
    }
    const out = auditPlanReorderCoverage(plan, blocks('b1', 'b2', 'b3'))
    expect(out.unaudited.map((m) => m.sectionId)).toContain('Bananas')
  })

  it('passes when the plan audits its move', () => {
    const plan = {
      sections: [
        { heading: 'Bananas', sourceBlockIds: ['b3'] },
        { heading: 'Apples', sourceBlockIds: ['b1'] },
      ],
      reorderings: [
        audit({ sourceBlockId: 'b3', fromIndex: 1, toIndex: 0 }),
        audit({ sourceBlockId: 'b1', fromIndex: 0, toIndex: 1 }),
      ],
    }
    const out = auditPlanReorderCoverage(plan, blocks('b1', 'b3'))
    expect(out.unaudited).toEqual([])
  })
})
