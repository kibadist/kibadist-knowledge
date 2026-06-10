import { describe, expect, it } from 'vitest'

import type { EditorialLayout, IllustrationSuggestion, InlineRun } from '../api'
import type { ArticleBlockV2, ArticleSectionV2, ArticleV2 } from '../article-v2'
import { ARTICLE_JSON_V2 } from '../article-v2'
import {
  buildEditorialPlan,
  type StreamItem,
  splitCaption,
} from '../editorial-layout'

// --- Fixture helpers ---------------------------------------------------------
// Compact builders so each test reads as the structure it exercises. Block ids
// are caller-supplied (figure anchoring binds to them); order_index follows
// array order unless overridden.

function run(text: string): InlineRun[] {
  return [{ text }]
}

let blockSeq = 0
function para(text: string, id?: string): ArticleBlockV2 {
  return {
    block_id: id ?? `p${blockSeq++}`,
    section_id: '',
    order_index: 0,
    type: 'paragraph',
    content: { runs: run(text) },
  }
}
function quote(
  text: string,
  id?: string,
  attribution?: string,
): ArticleBlockV2 {
  return {
    block_id: id ?? `q${blockSeq++}`,
    section_id: '',
    order_index: 0,
    type: 'quote',
    content: { runs: run(text), attribution },
  }
}
function callout(text: string, title?: string, id?: string): ArticleBlockV2 {
  return {
    block_id: id ?? `c${blockSeq++}`,
    section_id: '',
    order_index: 0,
    type: 'callout',
    content: { runs: run(text), title },
  }
}

function section(
  id: string,
  heading: string,
  blocks: ArticleBlockV2[],
  order = 0,
): ArticleSectionV2 {
  return {
    section_id: id,
    heading,
    order_index: order,
    blocks: blocks.map((b, i) => ({
      ...b,
      section_id: id,
      order_index: i,
    })),
  }
}

function article(sections: ArticleSectionV2[]): ArticleV2 {
  return {
    article_id: 'a1',
    source_id: 's1',
    schema_version: ARTICLE_JSON_V2,
    title: 'Test Article',
    generated_at: '2026-01-01T00:00:00Z',
    sections,
  }
}

function illus(
  over: Partial<IllustrationSuggestion> &
    Pick<IllustrationSuggestion, 'id' | 'illustrationType'>,
): IllustrationSuggestion {
  return {
    purpose: 'p',
    visualDescription: 'v',
    caption: 'A caption.',
    fidelityRisk: 'low' as IllustrationSuggestion['fidelityRisk'],
    reason: 'r',
    sourceBlockIds: [],
    approval: 'approved',
    image: {
      width: 1,
      height: 1,
      provider: 'openai',
      model: 'm',
      generatedAt: '2026-01-01T00:00:00Z',
    },
    ...over,
  }
}

// Flatten every section's stream items for assertions that span the article.
function allItems(plan: ReturnType<typeof buildEditorialPlan>): StreamItem[] {
  return plan.sections.flatMap((s) => s.items)
}
function figures(plan: ReturnType<typeof buildEditorialPlan>) {
  return allItems(plan).filter((i) => i.kind === 'figure')
}

// --- Tests -------------------------------------------------------------------

describe('buildEditorialPlan — figure placement', () => {
  it('(a) does NOT front-load an unanchored cover; it lands after the first section opening paragraphs', () => {
    const a = article([
      section('sec-1', 'Intro', [
        para('Opening one.', 'b1'),
        para('Opening two.', 'b2'),
        para('Body three.', 'b3'),
        para('Body four.', 'b4'),
      ]),
      section('sec-2', 'More', [para('Second section.', 'b5')], 1),
    ])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        // Unanchored cover: no sourceBlockIds map to any section.
        illus({
          id: 'i1',
          illustrationType: 'editorial_cover',
          sourceBlockIds: [],
        }),
      ],
    })

    const firstSection = plan.sections[0]
    // The very first stream item must be a paragraph (a body block), never a figure.
    expect(firstSection.items[0].kind).toBe('block')
    // The figure exists, and sits AFTER the opening paragraphs in section 1.
    const figIdx = firstSection.items.findIndex((i) => i.kind === 'figure')
    expect(figIdx).toBeGreaterThan(0)
    // It is preceded by at least 2 paragraph blocks.
    const paragraphsBefore = firstSection.items
      .slice(0, figIdx)
      .filter((i) => i.kind === 'block').length
    expect(paragraphsBefore).toBeGreaterThanOrEqual(2)
    expect(figures(plan)).toHaveLength(1)
  })

  it('(b) sizes source_based_diagram as column and cover/decorative as span', () => {
    const a = article([
      section('sec-1', 'Intro', [
        para('One.', 'b1'),
        para('Two.', 'b2'),
        para('Three.', 'b3'),
      ]),
    ])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        illus({
          id: 'diagram',
          illustrationType: 'source_based_diagram',
          sourceBlockIds: ['b1'],
        }),
        illus({
          id: 'cover',
          illustrationType: 'editorial_cover',
          sourceBlockIds: ['b2'],
        }),
        illus({
          id: 'deco',
          illustrationType: 'decorative_section',
          sourceBlockIds: ['b3'],
        }),
      ],
    })
    const figs = figures(plan)
    const bySize = new Map(
      figs.map((f) =>
        f.kind === 'figure'
          ? [f.figure.suggestion.id, f.figure.size]
          : ['', 'span'],
      ),
    )
    expect(bySize.get('diagram')).toBe('column')
    expect(bySize.get('cover')).toBe('span')
    expect(bySize.get('deco')).toBe('span')
  })

  it('(c) numbers in-column diagrams sequentially and binds (Fig. N) refs; span plates get no number/ref', () => {
    const a = article([
      section('sec-1', 'A', [
        para('One.', 'b1'),
        para('Two.', 'b2'),
        para('Three.', 'b3'),
      ]),
      section(
        'sec-2',
        'B',
        [para('Four.', 'b4'), para('Five.', 'b5'), para('Six.', 'b6')],
        1,
      ),
    ])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        illus({ id: 'd1', illustrationType: 'source_based_diagram' }),
        illus({ id: 'd2', illustrationType: 'source_based_diagram' }),
      ],
    })
    const cols = figures(plan).filter(
      (f) => f.kind === 'figure' && f.figure.size === 'column',
    )
    expect(cols).toHaveLength(2)
    const numbers = cols
      .map((f) => (f.kind === 'figure' ? f.figure.figureNumber : 0))
      .sort()
    expect(numbers).toEqual([1, 2])

    // Each in-column diagram binds a (Fig. N) ref to a paragraph.
    const refs = allItems(plan)
      .filter((i) => i.kind === 'block' && i.figureRef !== undefined)
      .map((i) => (i.kind === 'block' ? i.figureRef : undefined))
    expect(refs.length).toBeGreaterThanOrEqual(1)
    expect(refs).toContain(1)
  })

  it('(c2) a full-width span plate (cover/decorative) carries no number and no (Fig. N) ref', () => {
    const a = article([
      section('sec-1', 'A', [
        para('One.', 'b1'),
        para('Two.', 'b2'),
        para('Three.', 'b3'),
      ]),
    ])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        illus({ id: 'cover', illustrationType: 'editorial_cover' }),
      ],
    })
    const fig = figures(plan)[0]
    if (fig.kind !== 'figure') throw new Error('expected figure')
    expect(fig.figure.size).toBe('span')
    expect(fig.figure.figureNumber).toBe(0)
    // No dangling (Fig. N) prose ref for a span plate.
    const refs = allItems(plan).filter(
      (i) => i.kind === 'block' && i.figureRef !== undefined,
    )
    expect(refs).toHaveLength(0)
  })

  it('(c3) spreads multiple plates across sections instead of clustering them in the first', () => {
    const a = article([
      section('sec-1', 'A', [
        para('a', 'b1'),
        para('b', 'b2'),
        para('c', 'b3'),
      ]),
      section(
        'sec-2',
        'B',
        [para('d', 'b4'), para('e', 'b5'), para('f', 'b6')],
        1,
      ),
    ])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        illus({ id: 'c1', illustrationType: 'editorial_cover' }),
        illus({ id: 'c2', illustrationType: 'decorative_section' }),
      ],
    })
    const perSection = plan.sections.map(
      (s) => s.items.filter((i) => i.kind === 'figure').length,
    )
    // No section gets two plates; both sections receive one (spread, not clustered).
    expect(Math.max(...perSection)).toBe(1)
    expect(perSection.filter((n) => n > 0)).toHaveLength(2)
  })

  it('(c4) anchors a figure to the section whose block provenance matches its sourceBlockIds', () => {
    const s1 = section('sec-1', 'A', [para('a', 'b1'), para('b', 'b2')])
    const s2 = section('sec-2', 'B', [para('c', 'b3'), para('d', 'b4')], 1)
    // Give sec-2's first block a source-document provenance id.
    s2.blocks[0].source_span_ids = ['src-99']
    const a = article([s1, s2])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        illus({
          id: 'i1',
          illustrationType: 'source_based_diagram',
          sourceBlockIds: ['src-99'],
        }),
      ],
    })
    const sec2 = plan.sections.find((s) => s.sectionId === 'sec-2')
    expect(sec2?.items.some((i) => i.kind === 'figure')).toBe(true)
    // And NOT in sec-1.
    const sec1 = plan.sections.find((s) => s.sectionId === 'sec-1')
    expect(sec1?.items.some((i) => i.kind === 'figure')).toBe(false)
  })

  it('(d) splits a caption into takeaway + detail', () => {
    expect(splitCaption('The core idea. The rest explains it.')).toEqual({
      takeaway: 'The core idea',
      detail: 'The rest explains it.',
    })
    // No second sentence → whole caption is the takeaway.
    expect(splitCaption('Just one clause')).toEqual({
      takeaway: 'Just one clause',
      detail: '',
    })
    // Empty input does not throw.
    expect(splitCaption('')).toEqual({ takeaway: '', detail: '' })

    const a = article([
      section('sec-1', 'A', [
        para('x', 'b1'),
        para('y', 'b2'),
        para('z', 'b3'),
      ]),
    ])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        illus({
          id: 'i1',
          illustrationType: 'editorial_cover',
          sourceBlockIds: ['b1'],
          caption: 'Diffusion spreads heat. It moves from hot to cold regions.',
        }),
      ],
    })
    const fig = figures(plan)[0]
    if (fig.kind !== 'figure') throw new Error('expected figure')
    expect(fig.figure.caption.takeaway).toBe('Diffusion spreads heat')
    expect(fig.figure.caption.detail).toBe('It moves from hot to cold regions.')
  })
})

describe('buildEditorialPlan — stat band', () => {
  it('(e) derives a stat band from a numeric cluster and places it once', () => {
    const a = article([
      section('sec-1', 'Plain', [para('No numbers here at all.', 'b1')]),
      section(
        'sec-2',
        'Figures',
        [
          para('Sales grew 37% last year.', 'b2'),
          para('Revenue reached 12,000 units in 2021.', 'b3'),
          para('A 3× improvement followed.', 'b4'),
        ],
        1,
      ),
    ])
    const plan = buildEditorialPlan({ article: a })
    const bands = allItems(plan).filter((i) => i.kind === 'statband')
    expect(bands).toHaveLength(1)
    // It lands in the numeric-dense section (sec-2).
    const sec2 = plan.sections.find((s) => s.sectionId === 'sec-2')
    expect(sec2?.items.some((i) => i.kind === 'statband')).toBe(true)
  })

  it('(e) omits the stat band when there are no numbers', () => {
    const a = article([
      section('sec-1', 'A', [para('All words, no figures whatsoever.', 'b1')]),
    ])
    const plan = buildEditorialPlan({ article: a })
    expect(allItems(plan).some((i) => i.kind === 'statband')).toBe(false)
  })
})

describe('buildEditorialPlan — pull-quote', () => {
  it('(f) places exactly one pull-quote', () => {
    const a = article([
      section('sec-1', 'A', [
        para('First a setup sentence here.', 'b1'),
        para('Then the sharp thesis lands hard.', 'b2'),
        para('And a closing remark follows on.', 'b3'),
      ]),
      section(
        'sec-2',
        'B',
        [para('Another section with its own ideas here.', 'b4')],
        1,
      ),
    ])
    const plan = buildEditorialPlan({ article: a })
    const quotes = allItems(plan).filter((i) => i.kind === 'pullquote')
    expect(quotes).toHaveLength(1)
  })

  it('(f) prefers an explicit quote block as the pull-quote and does not duplicate it', () => {
    const a = article([
      section('sec-1', 'A', [
        para('Intro one.', 'b1'),
        para('Intro two.', 'b2'),
        quote('Knowledge must be earned.', 'b3', 'Anon'),
        para('Outro.', 'b4'),
      ]),
    ])
    const plan = buildEditorialPlan({ article: a })
    const quotes = allItems(plan).filter((i) => i.kind === 'pullquote')
    expect(quotes).toHaveLength(1)
    if (quotes[0].kind !== 'pullquote') throw new Error('expected pullquote')
    expect(quotes[0].text).toBe('Knowledge must be earned.')
    expect(quotes[0].attribution).toBe('Anon')
    // The quote block is NOT also rendered as an in-column block.
    const inColumnQuote = allItems(plan).some(
      (i) => i.kind === 'block' && i.block.type === 'quote',
    )
    expect(inColumnQuote).toBe(false)
  })
})

describe('buildEditorialPlan — marginal notes', () => {
  it('(g) spreads marginal notes (1–3) across sections, never clustered', () => {
    const a = article([
      section(
        'sec-1',
        'A',
        [para('p', 'b1'), callout('Aside one.', 'Note')],
        0,
      ),
      section('sec-2', 'B', [para('p', 'b2'), callout('Aside two.', 'Tip')], 1),
      section(
        'sec-3',
        'C',
        [para('p', 'b3'), callout('Aside three.', 'Tip')],
        2,
      ),
      section(
        'sec-4',
        'D',
        [para('p', 'b4'), callout('Aside four.', 'Tip')],
        3,
      ),
    ])
    const plan = buildEditorialPlan({ article: a })
    const marginals = allItems(plan).filter((i) => i.kind === 'marginal')
    expect(marginals.length).toBeGreaterThanOrEqual(1)
    expect(marginals.length).toBeLessThanOrEqual(3)
    // No two marginals in the same section (spread, not clustered).
    const perSection = plan.sections.map(
      (s) => s.items.filter((i) => i.kind === 'marginal').length,
    )
    expect(Math.max(...perSection)).toBeLessThanOrEqual(1)
  })
})

describe('buildEditorialPlan — sub-heads + cadence', () => {
  it('(h) inserts a sub-head break in a long section (>7 paragraphs)', () => {
    const blocks = Array.from({ length: 10 }, (_, i) =>
      para(`Paragraph number ${i}.`, `b${i}`),
    )
    const a = article([section('sec-1', 'Long', blocks)])
    const plan = buildEditorialPlan({ article: a })
    const subheads = plan.sections[0].items.filter((i) => i.kind === 'subhead')
    expect(subheads.length).toBeGreaterThanOrEqual(1)
  })

  it('marks the first body paragraph as the drop-cap lead, exactly once', () => {
    const a = article([
      section('sec-1', 'A', [para('First.', 'b1'), para('Second.', 'b2')]),
      section('sec-2', 'B', [para('Third.', 'b3')], 1),
    ])
    const plan = buildEditorialPlan({ article: a })
    const leads = allItems(plan).filter(
      (i) => i.kind === 'block' && i.isLead === true,
    )
    expect(leads).toHaveLength(1)
    if (leads[0].kind !== 'block') throw new Error('expected block')
    expect(leads[0].block.block_id).toBe('b1')
  })
})

describe('buildEditorialPlan — server furniture precedence + honesty', () => {
  const baseArticle = article([
    section('sec-1', 'A', [
      para('One.', 'b1'),
      para('Two.', 'b2'),
      para('Three.', 'b3'),
    ]),
  ])

  it('(i) server editorialLayout takes precedence over derived furniture', () => {
    const layout: EditorialLayout = {
      kicker: { text: 'SERVER KICKER', grounded: false },
      pullQuote: {
        sectionId: 'sec-1',
        text: 'A server-chosen thesis line.',
        grounded: true,
      },
      statBand: {
        grounded: true,
        stats: [
          { figure: '99%', label: 'server stat' },
          { figure: '7×', label: 'another' },
        ],
      },
    }
    const plan = buildEditorialPlan({
      article: baseArticle,
      editorialLayout: layout,
    })
    expect(plan.kicker).toBe('SERVER KICKER')
    const quotes = allItems(plan).filter((i) => i.kind === 'pullquote')
    expect(quotes).toHaveLength(1)
    if (quotes[0].kind !== 'pullquote') throw new Error('expected pullquote')
    expect(quotes[0].text).toBe('A server-chosen thesis line.')
    const bands = allItems(plan).filter((i) => i.kind === 'statband')
    expect(bands).toHaveLength(1)
    if (bands[0].kind !== 'statband') throw new Error('expected statband')
    expect(bands[0].stats[0].figure).toBe('99%')
  })

  it('(j) ungrounded server furniture is marked ai:true', () => {
    const layout: EditorialLayout = {
      kicker: { text: 'K', grounded: false },
      pullQuote: {
        sectionId: 'sec-1',
        text: 'Ungrounded line.',
        grounded: false,
      },
      statBand: {
        grounded: false,
        stats: [
          { figure: '1', label: 'x' },
          { figure: '2', label: 'y' },
        ],
      },
      marginalNotes: [
        {
          sectionId: 'sec-1',
          afterParagraphIndex: 1,
          title: 'Def',
          text: 'A definition.',
          grounded: false,
        },
      ],
    }
    const plan = buildEditorialPlan({
      article: baseArticle,
      editorialLayout: layout,
    })
    expect(plan.kickerAi).toBe(true)
    const quote = allItems(plan).find((i) => i.kind === 'pullquote')
    expect(quote?.kind === 'pullquote' && quote.ai).toBe(true)
    const band = allItems(plan).find((i) => i.kind === 'statband')
    expect(band?.kind === 'statband' && band.ai).toBe(true)
    const marginal = allItems(plan).find((i) => i.kind === 'marginal')
    expect(marginal?.kind === 'marginal' && marginal.ai).toBe(true)
  })

  it('grounded derived furniture is ai:false (lifted from the source)', () => {
    const a = article([
      section('sec-1', 'A', [
        para('A short sharp thesis sentence here now.', 'b1'),
        para('Revenue grew 40% and reached 5,000 units.', 'b2'),
        para('Then 3× more arrived after that.', 'b3'),
        callout('An aside.', 'Note', 'c1'),
      ]),
    ])
    const plan = buildEditorialPlan({ article: a })
    const band = allItems(plan).find((i) => i.kind === 'statband')
    expect(band?.kind === 'statband' && band.ai).toBe(false)
    const marginal = allItems(plan).find((i) => i.kind === 'marginal')
    expect(marginal?.kind === 'marginal' && marginal.ai).toBe(false)
  })
})

describe('buildEditorialPlan — abstract lede + figure refs from server', () => {
  it('lifts the abstract section above the columns and excludes it from the stream', () => {
    const a = article([
      section('a1-abstract', 'Abstract', [para('A faithful summary.', 'abs1')]),
      section('sec-1', 'Body', [para('Real body.', 'b1')], 1),
    ])
    const plan = buildEditorialPlan({ article: a })
    expect(plan.ledeParagraphs).toHaveLength(1)
    expect(plan.ledeParagraphs[0].blockId).toBe('abs1')
    // The abstract is NOT a planned section.
    expect(plan.sections.map((s) => s.sectionId)).toEqual(['sec-1'])
    // standfirst null because the grounded lede carries the opening.
    expect(plan.standfirst).toBeNull()
  })

  it('uses server figurePlacement caption + size when present', () => {
    const a = article([
      section('sec-1', 'A', [
        para('One.', 'b1'),
        para('Two.', 'b2'),
        para('Three.', 'b3'),
      ]),
    ])
    const layout: EditorialLayout = {
      figurePlacements: [
        {
          suggestionId: 'i1',
          sectionId: 'sec-1',
          afterParagraphIndex: 1,
          size: 'column',
          figureNumber: 1,
          caption: { takeaway: 'Server take', detail: 'Server detail.' },
        },
      ],
    }
    const plan = buildEditorialPlan({
      article: a,
      editorialLayout: layout,
      illustrations: [
        illus({
          id: 'i1',
          illustrationType: 'editorial_cover',
          sourceBlockIds: [],
        }),
      ],
    })
    const fig = figures(plan)[0]
    if (fig.kind !== 'figure') throw new Error('expected figure')
    expect(fig.figure.size).toBe('column')
    expect(fig.figure.caption).toEqual({
      takeaway: 'Server take',
      detail: 'Server detail.',
    })
  })
})

describe('buildEditorialPlan — edge cases', () => {
  it('(k) does not throw on an empty article', () => {
    const a = article([])
    expect(() => buildEditorialPlan({ article: a })).not.toThrow()
    const plan = buildEditorialPlan({ article: a })
    expect(plan.sections).toHaveLength(0)
    expect(plan.kicker).toBeTruthy()
  })

  it('(k) handles an abstract-only article (no body sections)', () => {
    const a = article([
      section('a1-abstract', 'Abstract', [para('Only a summary.', 'abs1')]),
    ])
    const plan = buildEditorialPlan({ article: a })
    expect(plan.ledeParagraphs).toHaveLength(1)
    expect(plan.sections).toHaveLength(0)
  })

  it('(k) handles no illustrations + no editorialLayout (pure Layer 1)', () => {
    const a = article([
      section('sec-1', 'A', [para('Body.', 'b1'), para('More.', 'b2')]),
    ])
    const plan = buildEditorialPlan({ article: a })
    expect(figures(plan)).toHaveLength(0)
    // A drop-cap lead still marks the first paragraph.
    expect(
      allItems(plan).some((i) => i.kind === 'block' && i.isLead === true),
    ).toBe(true)
  })

  it('(k) only approved + rendered illustrations become plates', () => {
    const a = article([
      section('sec-1', 'A', [
        para('x', 'b1'),
        para('y', 'b2'),
        para('z', 'b3'),
      ]),
    ])
    const plan = buildEditorialPlan({
      article: a,
      illustrations: [
        illus({
          id: 'pending',
          illustrationType: 'editorial_cover',
          approval: 'pending',
        }),
        illus({
          id: 'norender',
          illustrationType: 'editorial_cover',
          image: null,
        }),
        illus({
          id: 'ok',
          illustrationType: 'editorial_cover',
          sourceBlockIds: ['b1'],
        }),
      ],
    })
    const figs = figures(plan)
    expect(figs).toHaveLength(1)
    if (figs[0].kind !== 'figure') throw new Error('expected figure')
    expect(figs[0].figure.suggestion.id).toBe('ok')
  })

  it('falls back to the editorialLayout standfirst when there is no abstract lede', () => {
    const a = article([section('sec-1', 'A', [para('Body.', 'b1')])])
    const plan = buildEditorialPlan({
      article: a,
      editorialLayout: {
        standfirst: { text: 'A generated standfirst.', grounded: false },
      },
    })
    expect(plan.standfirst).not.toBeNull()
    expect(plan.standfirst?.text).toBe('A generated standfirst.')
    expect(plan.standfirst?.ai).toBe(true)
  })
})
