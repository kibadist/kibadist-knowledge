import {
  knownBlockIds,
  negativeFixtures,
  v1Fixture,
  v2Fixtures,
} from './__fixtures__'
import { caveatHeavy } from './__fixtures__/caveat-heavy'
import { UNSUPPORTED_HIGHLIGHT_UNKNOWN_ID } from './__fixtures__/unsupported-highlight'
import {
  collectArticleSourceBlockIds,
  findUnknownSourceBlockIds,
  toArticleV2,
} from './article-compat.util'
import { placeCallouts } from './callout-placement.util'
import { buildCoverageReport } from './coverage.util'
import { mergeDeterministicChecks } from './fidelity-checker.service'
import { buildReadingAids } from './reading-aids.util'
import { ArticleJsonV2Schema } from './schemas'
import type { FidelityReport } from './transformer.types'

/**
 * Golden fixture suite (DET-279). Deterministic recorded artifacts (NO live
 * LLM): for every hand-authored fixture we run the pure pipeline utilities
 * (schema validation, traceability walk, coverage, deterministic fidelity
 * traversal) and assert the source-preservation invariants hold for ALL block
 * types — paragraph, list, quote, pullQuote, table, code, figureAnchor, callout,
 * nested subsections, and the legacy v1 paragraph-only article.
 */

/** A clean LLM report (no findings, perfect score) to feed the deterministic
 * merge — the merge layer is what we are exercising on good fixtures. */
function cleanReport(): FidelityReport {
  return {
    fidelityScore: 100,
    approved: true,
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

/** Coverage blocks (id + uncertain) derived from a fixture's source blocks. */
function coverageBlocks(blocks: { id: string }[]) {
  return blocks.map((b) => ({ id: b.id, uncertain: false }))
}

/** Removable source blocks, as the reshaping plan would record them. */
function removedRefs(blocks: { id: string; removable: boolean }[]) {
  return blocks
    .filter((b) => b.removable)
    .map((b) => ({ blockId: b.id, reason: 'noise' }))
}

/**
 * The block ids a fixture's article cites in REPRESENTATIONAL positions, mirror
 * of the rule in `buildCoverageReport`: subtitle, abstract paragraphs, every
 * section/subsection's own sourceBlockIds AND every block's sourceBlockIds,
 * keyTerms, sourceExamples, caveats. (Coverage does NOT cite
 * `headingSourceBlockIds` separately — those ids are already in the section's
 * sourceBlockIds in these fixtures.)
 */
function coverageCitedIds(
  article: import('./transformer.types').ArticleJsonV2,
) {
  const ids = new Set<string>()
  const add = (xs: string[]) => {
    for (const x of xs) ids.add(x)
  }
  if (article.subtitle) add(article.subtitle.sourceBlockIds)
  for (const p of article.abstract) add(p.sourceBlockIds)
  const walk = (sections: typeof article.sections) => {
    for (const s of sections) {
      add(s.sourceBlockIds)
      for (const b of s.blocks) add(b.sourceBlockIds)
      if (s.subsections) walk(s.subsections)
    }
  }
  walk(article.sections)
  for (const t of article.keyTerms) add(t.sourceBlockIds)
  for (const e of article.sourceExamples) add(e.sourceBlockIds)
  for (const c of article.caveats) add(c.sourceBlockIds)
  return ids
}

describe('golden fixtures — coverage of every v2 block type', () => {
  it('exercises every ArticleBlock union member across the suite', () => {
    const types = new Set<string>()
    for (const { article } of v2Fixtures) {
      const walk = (sections: typeof article.sections): void => {
        for (const s of sections) {
          for (const b of s.blocks) types.add(b.type)
          if (s.subsections) walk(s.subsections)
        }
      }
      walk(article.sections)
    }
    expect([...types].sort()).toEqual([
      'callout',
      'code',
      'figureAnchor',
      'list',
      'paragraph',
      'pullQuote',
      'quote',
      'table',
    ])
  })

  it('exercises nested subsections in at least one fixture', () => {
    const hasNesting = v2Fixtures.some((f) =>
      f.article.sections.some((s) => (s.subsections?.length ?? 0) > 0),
    )
    expect(hasNesting).toBe(true)
  })
})

describe.each(
  v2Fixtures.map((f) => [f.name, f] as const),
)('golden fixture: %s', (_name, fixture) => {
  const known = knownBlockIds(fixture.blocks)

  it('validates against ArticleJsonV2Schema', () => {
    const result = ArticleJsonV2Schema.safeParse(fixture.article)
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it('cites only existing source block ids everywhere (source-inspector mapping intact)', () => {
    const cited = collectArticleSourceBlockIds(fixture.article)
    expect(cited.length).toBeGreaterThan(0)
    expect(findUnknownSourceBlockIds(fixture.article, known)).toEqual([])
  })

  it('coverage represents every cited block (incl. table/list/code/quote-only blocks) and maps every block', () => {
    const report = buildCoverageReport(
      fixture.article,
      coverageBlocks(fixture.blocks),
      removedRefs(fixture.blocks),
    )

    // Coverage represents exactly the blocks cited in representational
    // positions — and that set INCLUDES blocks cited ONLY through a typed
    // block (a table/list/code/quote/callout/figureAnchor), proving the
    // source-inspector mapping is intact for every block type.
    const expectedRepresented = [...coverageCitedIds(fixture.article)].sort()
    expect(report.representedBlockIds.sort()).toEqual(expectedRepresented)

    // The only blocks coverage leaves unrepresented are heading blocks the
    // article cites solely as heading provenance (headingSourceBlockIds) — a
    // heading carries no body text of its own, so coverage does not count it.
    // Nothing with real content is silently dropped.
    const headingOnly = new Set<string>()
    const collectHeadingIds = (sections: typeof fixture.article.sections) => {
      for (const s of sections) {
        for (const id of s.headingSourceBlockIds ?? []) headingOnly.add(id)
        if (s.subsections) collectHeadingIds(s.subsections)
      }
    }
    collectHeadingIds(fixture.article.sections)
    for (const id of report.unrepresentedBlockIds) {
      expect(headingOnly.has(id)).toBe(true)
    }

    // paragraphMap covers every abstract paragraph + every block (any type),
    // walking subsections — in document order.
    const expectedMapIds: string[] = fixture.article.abstract.map((p) => p.id)
    const walk = (sections: typeof fixture.article.sections) => {
      for (const s of sections) {
        for (const b of s.blocks) expectedMapIds.push(b.id)
        if (s.subsections) walk(s.subsections)
      }
    }
    walk(fixture.article.sections)
    expect(report.paragraphMap.map((m) => m.paragraphId)).toEqual(
      expectedMapIds,
    )
  })

  it('deterministic fidelity traversal finds no traceability violations', () => {
    const merged = mergeDeterministicChecks(
      cleanReport(),
      fixture.article,
      known,
    )
    // No high-severity lost-information findings were ADDED by the merge.
    expect(merged.lostInformation).toEqual([])
    expect(merged.unsupportedHeadings).toEqual([])
    expect(merged.approved).toBe(true)
  })
})

describe('golden fixture: reading aids (DET-274)', () => {
  it('builds deterministic, traceable reading aids over every v2 fixture', () => {
    for (const { article, blocks } of v2Fixtures) {
      const known = knownBlockIds(blocks)
      // No structure model in the fixtures → exercises the leading-paragraph
      // fallback (claims-based selection is covered in the unit spec).
      const aids = buildReadingAids(article, null)
      expect(aids).toBeDefined()
      if (!aids) continue

      // TOC mirrors the section hierarchy (top-level sections + one nesting).
      expect(aids.toc.map((t) => t.sectionId)).toEqual(
        article.sections.map((s) => s.id),
      )
      for (let i = 0; i < article.sections.length; i++) {
        const subs = article.sections[i].subsections ?? []
        if (subs.length > 0) {
          expect(aids.toc[i].children?.map((c) => c.sectionId)).toEqual(
            subs.map((s) => s.id),
          )
        }
      }

      // Reading time is positive minutes with a non-negative word count.
      expect(aids.readingTime.minutes).toBeGreaterThanOrEqual(1)
      expect(aids.readingTime.wordCount).toBeGreaterThanOrEqual(0)

      // Highlights, when present, are traceable verbatim source fragments. This
      // ties into checkUnsupportedHighlights: an enriched article must never
      // carry an untraceable highlight.
      for (const h of aids.highlights ?? []) {
        expect(h.sourceBlockIds.length).toBeGreaterThan(0)
        for (const id of h.sourceBlockIds) expect(known.has(id)).toBe(true)
      }

      // The enriched article (with computed aids) still has zero untraceable
      // citations and the deterministic merge keeps approving it.
      const enriched = { ...article, readingAids: aids }
      expect(findUnknownSourceBlockIds(enriched, known)).toEqual([])
      const merged = mergeDeterministicChecks(cleanReport(), enriched, known)
      expect(merged.approved).toBe(true)
    }
  })

  it('is deterministic and idempotent over a fixture', () => {
    const { article } = caveatHeavy
    expect(buildReadingAids(article, null)).toEqual(
      buildReadingAids(article, null),
    )
  })
})

describe('golden fixture: inline callout placement (DET-272)', () => {
  it('places every caveat that overlaps a section beside that section', () => {
    const { article } = caveatHeavy
    const placement = placeCallouts(article)

    // The caveat-heavy fixture's single section overlaps both caveats' source
    // blocks (b3, b4), so BOTH caveats land beside it and nothing is unplaced.
    const placedCaveats = Object.values(placement.bySection)
      .flat()
      .filter((c) => c.kind === 'caveat')
    expect(placedCaveats).toHaveLength(article.caveats.length)
    expect(placement.unplaced).toEqual([])

    // Each placed caveat carries a human-readable reason and mirrors its source
    // item's text exactly (re-placement, never a rewrite — plan decision 8).
    for (const c of placedCaveats) {
      expect(c.placementReason).toMatch(/overlap section/)
      expect(article.caveats.some((src) => src.text === c.text)).toBe(true)
    }
  })

  it('is deterministic and idempotent over the fixture', () => {
    const { article } = caveatHeavy
    expect(placeCallouts(article)).toEqual(placeCallouts(article))
  })
})

describe('golden fixture: article.v1 (legacy adapter)', () => {
  const known = knownBlockIds(v1Fixture.blocks)

  it('toArticleV2 adapts the v1 article and the result schema-validates', () => {
    const adapted = toArticleV2(v1Fixture.article)
    expect(adapted.schemaVersion).toBe('v2')
    const result = ArticleJsonV2Schema.safeParse(adapted)
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2))
    }
    expect(result.success).toBe(true)
  })

  it('coverage on the adapted v2 is identical to coverage on the v1 directly', () => {
    const blocks = coverageBlocks(v1Fixture.blocks)
    const fromV1 = buildCoverageReport(v1Fixture.article, blocks, [])
    const fromV2 = buildCoverageReport(
      toArticleV2(v1Fixture.article),
      blocks,
      [],
    )
    expect(fromV2).toEqual(fromV1)
  })

  it('cites only existing block ids and the deterministic checks approve it', () => {
    expect(findUnknownSourceBlockIds(v1Fixture.article, known)).toEqual([])
    const merged = mergeDeterministicChecks(
      cleanReport(),
      v1Fixture.article,
      known,
    )
    expect(merged.lostInformation).toEqual([])
    expect(merged.approved).toBe(true)
  })
})

describe('golden fixture: negatives', () => {
  it('unsupported-highlight: schema accepts the shape but the traceability walk flags the unknown id', () => {
    const { article, blocks } = negativeFixtures.unsupportedHighlight
    // The SHAPE is valid — sourceBlockIds is non-empty, so the schema passes.
    expect(ArticleJsonV2Schema.safeParse(article).success).toBe(true)
    // But the highlight references a block the source does not contain.
    const unknown = findUnknownSourceBlockIds(article, knownBlockIds(blocks))
    expect(unknown).toEqual([UNSUPPORTED_HIGHLIGHT_UNKNOWN_ID])
  })

  it('unsupported-highlight: the deterministic merge emits a high blocking structuralFinding (DET-281)', () => {
    const { article, blocks } = negativeFixtures.unsupportedHighlight
    const merged = mergeDeterministicChecks(
      cleanReport(),
      article,
      knownBlockIds(blocks),
    )
    const highlightFinding = merged.structuralFindings.find(
      (f) =>
        f.severity === 'high' &&
        (f.sourceBlockIds?.includes(UNSUPPORTED_HIGHLIGHT_UNKNOWN_ID) ?? false),
    )
    expect(highlightFinding).toBeDefined()
    expect(merged.approved).toBe(false)
  })

  it('unsafe-reorder fixture is schema-valid and fully traceable (the violation is semantic)', () => {
    const { article, blocks } = negativeFixtures.unsafeReorder
    expect(ArticleJsonV2Schema.safeParse(article).success).toBe(true)
    // Every fragment is traceable — the problem is the caveat/claim separation,
    // not a missing id. The blocking check is the cluster util (next test).
    expect(findUnknownSourceBlockIds(article, knownBlockIds(blocks))).toEqual(
      [],
    )
  })

  it('blocks caveat-separation reorder (DET-281)', () => {
    const { article, blocks, structureModel } = negativeFixtures.unsafeReorder
    // With the structure model + classified blocks, the cluster util sees the
    // caveat (b3) rendered two sections away from the claim (b2) it qualifies.
    const merged = mergeDeterministicChecks(
      cleanReport(),
      article,
      knownBlockIds(blocks),
      { structureModel, blocks },
    )
    const separation = merged.structuralFindings.find(
      (f) =>
        f.severity === 'high' && /separated from the claim/.test(f.description),
    )
    expect(separation).toBeDefined()
    expect(merged.approved).toBe(false)
  })
})
