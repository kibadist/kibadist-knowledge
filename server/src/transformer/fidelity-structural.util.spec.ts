import {
  checkDuplicateRendering,
  checkFullTraceability,
  checkProcedureListPreservation,
  checkQuoteAttribution,
  checkSourceGroundedExtras,
  checkUnsupportedHighlights,
  normalizeText,
  type SourceBlockText,
  type SourceBlockTyped,
} from './fidelity-structural.util'
import type { ArticleBlock, ArticleJsonV2 } from './transformer.types'

/** A minimal valid v2 article with the supplied section blocks. */
function article(
  blocks: ArticleBlock[],
  extra: Partial<ArticleJsonV2> = {},
): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections: [
      {
        id: 's1',
        heading: 'H',
        headingSource: 'original',
        sourceBlockIds: ['b1'],
        blocks,
      },
    ],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
    ...extra,
  }
}

const para = (id: string, text: string, ids: string[]): ArticleBlock => ({
  id,
  type: 'paragraph',
  text,
  sourceBlockIds: ids,
  transformationType: 'verbatim',
  fidelityRisk: 'low',
})

describe('normalizeText', () => {
  it('lowercases, collapses whitespace, strips punctuation', () => {
    expect(normalizeText('  Hello,   WORLD!! ')).toBe('hello world')
    expect(normalizeText('A—B. c')).toBe('a b c')
  })
})

describe('checkFullTraceability', () => {
  const known = new Set(['b1', 'b2'])

  it('passes for an all-traceable article', () => {
    const a = article([para('p1', 'x', ['b2'])])
    const res = checkFullTraceability(a, known)
    expect(res.structuralFindings).toEqual([])
    expect(res.traceabilityViolation).toBe(false)
  })

  it('flags a block with no sourceBlockIds', () => {
    const a = article([para('p1', 'x', [])])
    const res = checkFullTraceability(a, known)
    expect(res.traceabilityViolation).toBe(true)
    expect(res.structuralFindings.some((f) => f.severity === 'high')).toBe(true)
  })

  it('flags a caveat referencing an unknown id', () => {
    const a = article([para('p1', 'x', ['b2'])], {
      caveats: [{ text: 'c', sourceBlockIds: ['ghost'] }],
    })
    const res = checkFullTraceability(a, known)
    expect(res.traceabilityViolation).toBe(true)
    expect(
      res.structuralFindings.some((f) =>
        f.description.includes('unknown block'),
      ),
    ).toBe(true)
  })

  it('flags an unknown reading-aid highlight id', () => {
    const a = article([para('p1', 'x', ['b2'])], {
      readingAids: {
        toc: [{ sectionId: 's1', heading: 'H', headingSource: 'original' }],
        readingTime: { wordCount: 1, minutes: 1 },
        highlights: [{ text: 'h', sourceBlockIds: ['ghost'] }],
      },
    })
    const res = checkFullTraceability(a, known)
    expect(res.traceabilityViolation).toBe(true)
  })
})

describe('checkUnsupportedHighlights', () => {
  const known = new Set(['b1', 'b2'])

  it('returns nothing when there are no reading aids', () => {
    expect(
      checkUnsupportedHighlights(article([para('p1', 'x', ['b2'])]), known),
    ).toEqual([])
  })

  it('flags an empty-id highlight as high severity', () => {
    const a = article([para('p1', 'x', ['b2'])], {
      readingAids: {
        toc: [{ sectionId: 's1', heading: 'H', headingSource: 'original' }],
        readingTime: { wordCount: 1, minutes: 1 },
        highlights: [{ text: 'h', sourceBlockIds: [] }],
      },
    })
    const out = checkUnsupportedHighlights(a, known)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('high')
  })

  it('flags an unknown-id highlight as high severity', () => {
    const a = article([para('p1', 'x', ['b2'])], {
      readingAids: {
        toc: [{ sectionId: 's1', heading: 'H', headingSource: 'original' }],
        readingTime: { wordCount: 1, minutes: 1 },
        highlights: [{ text: 'h', sourceBlockIds: ['ghost'] }],
      },
    })
    const out = checkUnsupportedHighlights(a, known)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('high')
  })
})

describe('checkQuoteAttribution (heuristic)', () => {
  const quote = (
    id: string,
    text: string,
    ids: string[],
    attribution?: string,
  ): ArticleBlock => ({
    id,
    type: 'quote',
    text,
    ...(attribution ? { attribution } : {}),
    sourceBlockIds: ids,
    transformationType: 'verbatim',
    fidelityRisk: 'low',
  })

  it('flags a quote that drops an em-dash attribution present in the source', () => {
    const sources: SourceBlockText[] = [
      { id: 'b1', text: 'The unexamined life is not worth living. — Socrates' },
    ]
    const a = article([
      quote('q1', 'The unexamined life is not worth living.', ['b1']),
    ])
    const out = checkQuoteAttribution(a, sources)
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('medium')
    expect(out[0].articleRef).toBe('q1')
  })

  it('flags an "according to X" attribution loss', () => {
    const sources: SourceBlockText[] = [
      {
        id: 'b1',
        text: 'According to Curie, persistence pays off in research.',
      },
    ]
    const a = article([
      quote('q1', 'Persistence pays off in research.', ['b1']),
    ])
    const out = checkQuoteAttribution(a, sources)
    expect(out).toHaveLength(1)
  })

  it('does not flag when the quote carries an attribution field', () => {
    const sources: SourceBlockText[] = [
      { id: 'b1', text: 'Knowledge is power. — Bacon' },
    ]
    const a = article([
      quote('q1', 'Knowledge is power.', ['b1'], 'Francis Bacon'),
    ])
    expect(checkQuoteAttribution(a, sources)).toEqual([])
  })

  it('does not flag when the quote text already contains the name', () => {
    const sources: SourceBlockText[] = [
      { id: 'b1', text: 'I think therefore I am. — Descartes' },
    ]
    const a = article([
      quote('q1', 'As Descartes put it: I think therefore I am.', ['b1']),
    ])
    expect(checkQuoteAttribution(a, sources)).toEqual([])
  })

  it('does not flag a source with no attribution pattern', () => {
    const sources: SourceBlockText[] = [
      { id: 'b1', text: 'Water boils at one hundred degrees at sea level.' },
    ]
    const a = article([
      quote('q1', 'Water boils at one hundred degrees at sea level.', ['b1']),
    ])
    expect(checkQuoteAttribution(a, sources)).toEqual([])
  })
})

describe('checkDuplicateRendering', () => {
  it('passes when every block is unique', () => {
    const a = article([para('p1', 'alpha', ['b1']), para('p2', 'beta', ['b1'])])
    const out = checkDuplicateRendering(a)
    expect(out.findings).toEqual([])
    expect(out.highSeverity).toBe(false)
  })

  it('flags the same text rendered twice across blocks (medium)', () => {
    const a = article([
      para('p1', 'Repeated sentence here.', ['b1']),
      para('p2', 'Repeated sentence here.', ['b1']),
    ])
    const out = checkDuplicateRendering(a)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].severity).toBe('medium')
    expect(out.highSeverity).toBe(false)
  })

  it('exempts a pullQuote that re-displays a paragraph (display emphasis)', () => {
    const pull: ArticleBlock = {
      id: 'pq1',
      type: 'pullQuote',
      text: 'Repeated sentence here.',
      sourceBlockIds: ['b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    }
    const a = article([para('p1', 'Repeated sentence here.', ['b1']), pull])
    const out = checkDuplicateRendering(a)
    expect(out.findings).toEqual([])
  })

  it('flags a fully duplicated CAVEAT as high severity', () => {
    const a = article([para('p1', 'Do not exceed the dose.', ['b1'])], {
      caveats: [{ text: 'Do not exceed the dose.', sourceBlockIds: ['b1'] }],
    })
    const out = checkDuplicateRendering(a)
    expect(out.highSeverity).toBe(true)
    expect(out.findings.some((f) => f.severity === 'high')).toBe(true)
  })

  it('flags a block duplicated into a top-level sourceExample (medium)', () => {
    const a = article([para('p1', 'An illustrative example.', ['b1'])], {
      sourceExamples: [
        { text: 'An illustrative example.', sourceBlockIds: ['b1'] },
      ],
    })
    const out = checkDuplicateRendering(a)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].severity).toBe('medium')
  })
})

describe('checkProcedureListPreservation (DET-273)', () => {
  // An ORDERED source LIST block (numeric markers across 2+ lines).
  const orderedList: SourceBlockTyped = {
    id: 'b1',
    type: 'LIST',
    text: '1. Rinse the filter.\n2. Add the coffee.\n3. Pour the water.',
  }
  const listBlock = (ids: string[]): ArticleBlock => ({
    id: 'l1',
    type: 'list',
    ordered: true,
    items: ['Rinse the filter.', 'Add the coffee.', 'Pour the water.'],
    sourceBlockIds: ids,
    transformationType: 'formatting_only',
    fidelityRisk: 'low',
  })

  it('returns nothing for a non-procedure shape (not its concern)', () => {
    // The ordered source list was flattened to prose, but shape is 'explainer'.
    const a = article([para('p1', 'Rinse, add coffee, then pour.', ['b1'])])
    expect(
      checkProcedureListPreservation(a, 'explainer', [orderedList]),
    ).toEqual([])
  })

  it('flags a procedure whose ordered source list became prose (high, blocking)', () => {
    const a = article([para('p1', 'Rinse, add coffee, then pour.', ['b1'])])
    const out = checkProcedureListPreservation(a, 'procedure', [orderedList])
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('high')
    expect(out[0].sourceBlockIds).toEqual(['b1'])
  })

  it('does NOT flag a procedure that keeps the ordered source list as a list block', () => {
    const a = article([listBlock(['b1'])])
    expect(
      checkProcedureListPreservation(a, 'procedure', [orderedList]),
    ).toEqual([])
  })

  it('does NOT flag an UNORDERED source list flattened to prose (only ordered lists)', () => {
    const unordered: SourceBlockTyped = {
      id: 'b1',
      type: 'LIST',
      text: '- apples\n- pears\n- plums',
    }
    const a = article([para('p1', 'apples, pears and plums', ['b1'])])
    expect(checkProcedureListPreservation(a, 'procedure', [unordered])).toEqual(
      [],
    )
  })

  it('does NOT flag an ordered source list the article never cites (coverage, not flattening)', () => {
    const a = article([para('p1', 'Unrelated prose.', ['b2'])])
    expect(
      checkProcedureListPreservation(a, 'procedure', [orderedList]),
    ).toEqual([])
  })
})

describe('checkSourceGroundedExtras (DET-350)', () => {
  const known = new Set(['b1', 'b2'])

  it('passes when generated callouts and tables are grounded in known blocks', () => {
    const a = article([para('p1', 'x', ['b1'])], {
      calloutPlacements: {
        bySection: {},
        unplaced: [],
        generated: [
          {
            id: 'gco-key_idea-0',
            type: 'key_idea',
            title: 'K',
            body: 'B',
            sourceBlockIds: ['b1'],
            relatedSectionIds: ['s1'],
            fidelityRisk: 'low',
          },
        ],
      },
      tables: [
        {
          id: 'gtbl-0',
          title: 'T',
          columns: ['A', 'B'],
          rows: [
            { cells: [{ text: 'a' }, { text: 'b' }], sourceBlockIds: ['b1'] },
            { cells: [{ text: 'c' }, { text: 'd' }], sourceBlockIds: ['b2'] },
          ],
          sourceBlockIds: ['b1', 'b2'],
          relatedSectionIds: ['s1'],
          fidelityRisk: 'low',
        },
      ],
    })
    const result = checkSourceGroundedExtras(a, known)
    expect(result.traceabilityViolation).toBe(false)
    expect(result.structuralFindings).toEqual([])
  })

  it('rejects an unsupported callout (unknown source block id)', () => {
    const a = article([para('p1', 'x', ['b1'])], {
      calloutPlacements: {
        bySection: {},
        unplaced: [],
        generated: [
          {
            id: 'gco-source_analogy-0',
            type: 'source_analogy',
            title: 'Invented analogy',
            body: 'Not in the source.',
            sourceBlockIds: ['ghost'],
            relatedSectionIds: [],
            fidelityRisk: 'high',
          },
        ],
      },
    })
    const result = checkSourceGroundedExtras(a, known)
    expect(result.traceabilityViolation).toBe(true)
    expect(result.structuralFindings[0].severity).toBe('high')
    expect(result.structuralFindings[0].articleRef).toBe('gco-source_analogy-0')
  })

  it('rejects a table whose row cites an unknown block', () => {
    const a = article([para('p1', 'x', ['b1'])], {
      tables: [
        {
          id: 'gtbl-0',
          title: 'External facts',
          columns: ['A', 'B'],
          rows: [
            { cells: [{ text: 'a' }, { text: 'b' }], sourceBlockIds: ['b1'] },
            {
              cells: [{ text: 'c' }, { text: 'd' }],
              sourceBlockIds: ['ghost'],
            },
          ],
          sourceBlockIds: ['b1', 'ghost'],
          relatedSectionIds: [],
          fidelityRisk: 'low',
        },
      ],
    })
    const result = checkSourceGroundedExtras(a, known)
    expect(result.traceabilityViolation).toBe(true)
    expect(
      result.structuralFindings.some((f) => f.articleRef === 'gtbl-0-row-1'),
    ).toBe(true)
  })
})
