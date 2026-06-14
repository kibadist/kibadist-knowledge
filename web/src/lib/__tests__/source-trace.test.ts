import { describe, expect, it } from 'vitest'

import {
  buildSourceTraceIndex,
  deriveConfidence,
  hasProvenanceContent,
} from '@/lib/source-trace'

import { structuredFixture, transcriptFixture } from './source-trace.fixture'

describe('deriveConfidence', () => {
  it('is low whenever the fragment has no resolvable source', () => {
    expect(
      deriveConfidence({ transformationType: 'verbatim', hasSource: false }),
    ).toBe('low')
  })

  it('tracks fidelity risk first, then transformation type', () => {
    expect(deriveConfidence({ fidelityRisk: 'high', hasSource: true })).toBe(
      'low',
    )
    expect(deriveConfidence({ fidelityRisk: 'medium', hasSource: true })).toBe(
      'medium',
    )
    expect(
      deriveConfidence({
        fidelityRisk: 'low',
        transformationType: 'verbatim',
        hasSource: true,
      }),
    ).toBe('high')
    expect(
      deriveConfidence({
        fidelityRisk: 'low',
        transformationType: 'light_reword',
        hasSource: true,
      }),
    ).toBe('medium')
  })

  it('treats no transformation metadata (claims/concepts) as medium when sourced', () => {
    expect(deriveConfidence({ hasSource: true })).toBe('medium')
  })
})

describe('buildSourceTraceIndex — transcript fixture', () => {
  const index = buildSourceTraceIndex(transcriptFixture)

  it('keys every body + abstract block by its rendered block id', () => {
    expect(index.byBlockId.has('t-abs-0')).toBe(true)
    expect(index.byBlockId.has('t-p1')).toBe(true)
    expect(index.byBlockId.has('t-p2')).toBe(true)
    expect(index.byBlockId.has('t-callout-1')).toBe(true)
  })

  it('resolves source blocks in ORIGINAL order with previews + location', () => {
    const callout = index.byBlockId.get('t-callout-1')
    expect(callout?.sourceBlocks).toHaveLength(1)
    const src = callout?.sourceBlocks[0]
    expect(src?.text).toContain('not every cell')
    expect(src?.location).toBe('chars 139–202')
    expect(src?.classificationLabel).toBe('Evidence')
  })

  it('flags a paragraph with a hallucinated source id as unsupported', () => {
    const ghost = index.byBlockId.get('t-p2')
    expect(ghost?.unsupported).toBe(true)
    expect(ghost?.sourceBlocks).toHaveLength(0)
    expect(ghost?.missingBlockIds).toEqual(['t-ghost'])
    expect(ghost?.confidence).toBe('low')
  })

  it('carries per-block transformation type + fidelity risk through', () => {
    const p1 = index.byBlockId.get('t-p1')
    expect(p1?.transformationType).toBe('light_reword')
    expect(p1?.fidelityRisk).toBe('low')
    expect(p1?.confidence).toBe('medium')
  })

  it('surfaces claims, concepts, candidates and prompts with their source', () => {
    expect(index.claims).toHaveLength(1)
    expect(index.claims[0].sourceBlocks[0].id).toBe('t-b1')
    expect(index.concepts[0].generatedText).toContain('ATP')
    expect(index.conceptCandidates[0].sectionId).toBe('t-sec-1')
    expect(index.conceptCandidates[0].sectionHeading).toBe('Energy')
    // A retrieval prompt's source blocks are the expected-answer source.
    expect(index.retrievalPrompts[0].sourceBlocks[0].id).toBe('t-b1')
  })

  it('turns every fidelity finding into a quality warning with article ref', () => {
    expect(index.qualityWarnings).toHaveLength(2)
    const added = index.qualityWarnings.find((w) => w.articleRef === 't-p2')
    expect(added?.severity).toBe('high')
    expect(added?.fidelityRisk).toBe('high')
    // No source blocks on the "added information" finding → unsupported warning.
    expect(added?.unsupported).toBe(true)
    const meaning = index.qualityWarnings.find(
      (w) => w.articleRef === 't-callout-1',
    )
    expect(meaning?.sourceBlocks[0].id).toBe('t-b2')
  })

  it('collects callout blocks into a dedicated provenance group', () => {
    // The layout may render a callout as a non-interactive marginal, so the
    // appendix is the guaranteed inspection path (DET-358).
    expect(index.callouts).toHaveLength(1)
    expect(index.callouts[0].id).toBe('t-callout-1')
    expect(index.callouts[0].kind).toBe('callout')
    expect(index.callouts[0].sourceBlocks[0].id).toBe('t-b2')
  })

  it('reports provenance content present', () => {
    expect(hasProvenanceContent(index)).toBe(true)
  })
})

describe('buildSourceTraceIndex — structured fixture', () => {
  const index = buildSourceTraceIndex(structuredFixture)

  it('marks a verbatim, low-risk paragraph as high confidence', () => {
    const p1 = index.byBlockId.get('s-p1')
    expect(p1?.transformationType).toBe('verbatim')
    expect(p1?.confidence).toBe('high')
    expect(p1?.unsupported).toBe(false)
  })

  it('traces a table to multiple source blocks in original order', () => {
    const table = index.byBlockId.get('s-table-1')
    expect(table?.kind).toBe('table')
    expect(table?.sourceBlocks.map((b) => b.id)).toEqual(['s-b1', 's-b2'])
    expect(table?.generatedText).toContain('Light | Glucose')
  })

  it('has no quality warnings when the article carries no fidelity report', () => {
    expect(index.qualityWarnings).toHaveLength(0)
  })

  it('still surfaces claims, concepts and prompts', () => {
    expect(index.claims).toHaveLength(1)
    expect(index.concepts).toHaveLength(1)
    expect(index.retrievalPrompts).toHaveLength(1)
    expect(index.conceptCandidates).toHaveLength(0)
    expect(hasProvenanceContent(index)).toBe(true)
  })
})

describe('buildSourceTraceIndex — empty / missing data', () => {
  it('returns an empty index for a null article', () => {
    const index = buildSourceTraceIndex({ article: null, blocks: [] })
    expect(index.byBlockId.size).toBe(0)
    expect(hasProvenanceContent(index)).toBe(false)
  })
})
