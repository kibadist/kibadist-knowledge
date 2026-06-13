import { fireEvent, render, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  structuredFixture,
  transcriptFixture,
} from '@/lib/__tests__/source-trace.fixture'
import { buildSourceTraceIndex } from '@/lib/source-trace'
import { transformerArticleToV2 } from '@/lib/transformer-to-article-v2'

import { MagazineArticle } from '../magazine-article'

// Render the v3 reader exactly as the /read workspace does: the lossy learning
// ArticleV2 for layout + the rich source-trace index for provenance. No network
// (no illustrations → the plate's authed blob fetch never runs).
function renderReader(
  fixture: typeof transcriptFixture | typeof structuredFixture,
  opts: { debug?: boolean } = {},
) {
  const v2 = transformerArticleToV2(fixture.article, {
    articleId: 'a1',
    sourceId: 's1',
  })
  const index = buildSourceTraceIndex(fixture)
  return render(
    <MagazineArticle
      article={v2}
      articleId='a1'
      sourceTrace={index}
      debug={opts.debug}
    />,
  )
}

describe('MagazineArticle provenance (transcript fixture)', () => {
  it('makes a sourced paragraph inspectable and opens the drawer on click', () => {
    const { container } = renderReader(transcriptFixture)
    const p = container.querySelector('#t-p1') as HTMLElement
    expect(p).toBeTruthy()
    expect(p.getAttribute('role')).toBe('button')
    expect(p.className).toContain('kb-mag-traceable')

    // No drawer until clicked.
    expect(container.querySelector('.kb-trace')).toBeFalsy()
    fireEvent.click(p)
    const drawer = container.querySelector('.kb-trace') as HTMLElement
    expect(drawer).toBeTruthy()
    // The drawer shows the ORIGINAL source text + the generated text.
    expect(drawer.textContent).toContain('energy currency')
    expect(drawer.textContent).toContain('Light reword')
  })

  it('flags an unsupported paragraph (hallucinated source) without a click', () => {
    const { container } = renderReader(transcriptFixture)
    const ghost = container.querySelector('#t-p2') as HTMLElement
    expect(ghost.className).toContain('is-unsupported')
    expect(ghost.textContent).toContain('unsupported')
    // Opening it shows the graceful warning fallback, not a phantom source.
    fireEvent.click(ghost)
    const drawer = container.querySelector('.kb-trace') as HTMLElement
    expect(drawer.className).toContain('is-unsupported')
    expect(drawer.textContent).toContain('No source could be traced')
  })

  it('hides source ids by default and reveals them in debug mode', () => {
    const plain = renderReader(transcriptFixture)
    fireEvent.click(plain.container.querySelector('#t-p1') as HTMLElement)
    expect(plain.container.querySelector('.kb-trace-id')).toBeFalsy()

    const dbg = renderReader(transcriptFixture, { debug: true })
    fireEvent.click(dbg.container.querySelector('#t-p1') as HTMLElement)
    const id = dbg.container.querySelector('.kb-trace-id') as HTMLElement
    expect(id).toBeTruthy()
    expect(id.textContent).toBe('t-b1')
  })

  it('renders the provenance appendix with claims, concepts, prompts and warnings', () => {
    const { container, getByText } = renderReader(transcriptFixture)
    const panel = container.querySelector('.kb-prov') as HTMLElement
    expect(panel).toBeTruthy()
    expect(within(panel).getByText('Claims')).toBeTruthy()
    expect(within(panel).getByText('Concepts')).toBeTruthy()
    expect(within(panel).getByText('Concept candidates')).toBeTruthy()
    expect(within(panel).getByText('Retrieval prompts')).toBeTruthy()
    expect(within(panel).getByText('Quality warnings')).toBeTruthy()
    // The drawer-target labels exist regardless of where they render.
    expect(getByText(/energy currency of the cell/)).toBeTruthy()
  })

  it('opens the drawer from a provenance row (a quality warning → article ref)', () => {
    const { container } = renderReader(transcriptFixture)
    const panel = container.querySelector('.kb-prov') as HTMLElement
    // The "added information" warning row mentions the unsupported claim.
    const row = within(panel).getByText(/multiply without limit/i)
    fireEvent.click(row)
    const drawer = container.querySelector('.kb-trace') as HTMLElement
    expect(drawer).toBeTruthy()
    expect(drawer.textContent).toContain('Article ref')
    expect(drawer.textContent).toContain('t-p2')
  })
})

describe('MagazineArticle provenance (structured fixture)', () => {
  it('inspects a table traced to multiple source blocks in original order', () => {
    const { container } = renderReader(structuredFixture)
    const table = container.querySelector('#s-table-1') as HTMLElement
    expect(table.tagName).toBe('TABLE')
    expect(table.className).toContain('kb-mag-traceable')
    fireEvent.click(table)
    const drawer = container.querySelector('.kb-trace') as HTMLElement
    const quotes = drawer.querySelectorAll('.kb-trace-source blockquote')
    expect(quotes.length).toBe(2)
    // Original order: s-b1 (the definition) before s-b2 (where it happens).
    expect(quotes[0].textContent).toContain('converts light energy')
    expect(quotes[1].textContent).toContain('chloroplasts')
  })

  it('shows no quality warnings when the article has no fidelity report', () => {
    const { container } = renderReader(structuredFixture)
    const panel = container.querySelector('.kb-prov') as HTMLElement
    expect(
      within(panel).getByText(/the reshape held up against the source/i),
    ).toBeTruthy()
  })
})

describe('MagazineArticle without a trace index', () => {
  it('renders inert (no affordance, no appendix) — pure presentation', () => {
    const v2 = transformerArticleToV2(structuredFixture.article, {
      articleId: 'a1',
      sourceId: 's1',
    })
    const { container } = render(
      <MagazineArticle article={v2} articleId='a1' />,
    )
    expect(container.querySelector('.kb-mag-traceable')).toBeFalsy()
    expect(container.querySelector('.kb-prov')).toBeFalsy()
    expect(container.querySelector('.kb-trace')).toBeFalsy()
  })
})
