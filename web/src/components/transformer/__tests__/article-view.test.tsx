import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ArticleView } from '../article-view'
import type { InspectorSelection } from '../source-inspector-panel'
import { fixtureArticle } from './article-view.fixture'

/**
 * Web renderer smoke tests (DET-279, decision 9). Render `ArticleView` against a
 * fixture v2 article (no network: `illustrationPlan` is null so no inline
 * illustration slot mounts a mutation). We assert every `ArticleBlock` union
 * member renders something readable, that clicking a source-grounded paragraph
 * fires `onInspect` with the right sourceBlockIds, and that an untraceable block
 * renders the "missing source" chip and is NOT clickable.
 */

function renderArticleView(onInspect: (s: InspectorSelection) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(
    <ArticleView
      article={fixtureArticle}
      articleId='art-1'
      illustrationPlan={null}
      sourceBlockCount={8}
      masthead={null}
      onInspect={onInspect}
    />,
    { wrapper },
  )
}

describe('ArticleView (v2 renderer)', () => {
  it('renders the hero, abstract lede and section heading', () => {
    renderArticleView(vi.fn())
    expect(
      screen.getByRole('heading', { level: 1, name: 'Every block type' }),
    ).toBeInTheDocument()
    expect(screen.getByText('A renderer smoke fixture')).toBeInTheDocument()
    expect(
      screen.getByText('This abstract paragraph is the lede.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'All blocks' }),
    ).toBeInTheDocument()
  })

  it('renders each ArticleBlock union member with its own semantic element', () => {
    const { container } = renderArticleView(vi.fn())
    // paragraph
    expect(
      screen.getByText('A clickable source-grounded paragraph.'),
    ).toBeInTheDocument()
    // list — ordered renders <ol>, unordered renders <ul>
    expect(container.querySelector('ol.tf-list--ordered')).toBeInTheDocument()
    expect(container.querySelector('ul.tf-list--unordered')).toBeInTheDocument()
    expect(screen.getByText('First step')).toBeInTheDocument()
    expect(screen.getByText('Bullet one')).toBeInTheDocument()
    // quote — a <blockquote> with an em-dash attribution line
    const blockquote = container.querySelector('blockquote.tf-quote-text')
    expect(blockquote).toBeInTheDocument()
    expect(blockquote?.textContent).toContain('A memorable line.')
    expect(screen.getByText('— Someone')).toBeInTheDocument()
    // pullQuote — large display quote
    expect(screen.getByText(/A pulled excerpt\./)).toBeInTheDocument()
    // table — a real <table> with header cells and body cells
    const table = container.querySelector('table.tf-table')
    expect(table).toBeInTheDocument()
    expect(table?.querySelectorAll('thead th')).toHaveLength(2)
    expect(screen.getByText('A small table')).toBeInTheDocument()
    // code — a <pre><code> monospace block + language chip
    const pre = container.querySelector('pre.tf-code-pre code')
    expect(pre?.textContent).toBe('const x = 1')
    expect(screen.getByText('ts')).toBeInTheDocument()
    // figureAnchor — metadata-only inspector marker (caption present)
    expect(screen.getByText(/A figure caption\./)).toBeInTheDocument()
    // callout — bordered aside with optional title
    const callout = container.querySelector('aside.tf-callout')
    expect(callout).toBeInTheDocument()
    expect(screen.getByText('A callout body.')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('fires onInspect with the right sourceBlockIds when a paragraph is clicked', async () => {
    const onInspect = vi.fn()
    renderArticleView(onInspect)
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', {
        name: 'A clickable source-grounded paragraph.',
      }),
    )

    expect(onInspect).toHaveBeenCalledTimes(1)
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Paragraph',
        transformedText: 'A clickable source-grounded paragraph.',
        sourceBlockIds: ['b2'],
      }),
    )
  })

  it('opens the inspector from every typed block with its sourceBlockIds', () => {
    // Each typed block is wrapped in a clickable button carrying its own
    // sourceBlockIds + kind label. We click each and assert the callback.
    // fireEvent.click drives the wrapper <button> directly (userEvent declines a
    // button that nests block-level content like <ol>/<table>/<pre>).
    const cases: {
      text: RegExp
      kind: string
      sourceBlockIds: string[]
      /** Pull-quotes expose a separate "source ¶" ref button, not a wrapper. */
      viaRef?: boolean
    }[] = [
      { text: /First step/, kind: 'List', sourceBlockIds: ['b3'] },
      { text: /A memorable line/, kind: 'Quote', sourceBlockIds: ['b4'] },
      {
        text: /A pulled excerpt/,
        kind: 'Pull-quote',
        sourceBlockIds: ['b5'],
        viaRef: true,
      },
      { text: /A small table/, kind: 'Table', sourceBlockIds: ['b6'] },
      { text: /const x = 1/, kind: 'Code', sourceBlockIds: ['b7'] },
      {
        text: /A figure caption/,
        kind: 'Figure anchor',
        sourceBlockIds: ['b8'],
      },
      { text: /A callout body/, kind: 'Callout', sourceBlockIds: ['b2'] },
    ]

    for (const c of cases) {
      const onInspect = vi.fn()
      const { unmount } = renderArticleView(onInspect)
      const node = screen.getByText(c.text)
      const figure = node.closest('figure')
      const button = c.viaRef
        ? figure?.querySelector<HTMLButtonElement>('.tf-pullquote-ref')
        : node.closest('button')
      expect(button).not.toBeNull()
      fireEvent.click(button as HTMLButtonElement)
      expect(onInspect).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: c.kind,
          sourceBlockIds: c.sourceBlockIds,
        }),
      )
      unmount()
    }
  })

  it('opens the inspector from a source-grounded section heading (DET-276)', async () => {
    const onInspect = vi.fn()
    renderArticleView(onInspect)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'All blocks' }))

    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Section heading',
        transformedText: 'All blocks',
        sourceBlockIds: ['b1'],
      }),
    )
  })

  it('renders one level of subsections with their own source-grounded heading (DET-276)', async () => {
    const onInspect = vi.fn()
    renderArticleView(onInspect)
    const user = userEvent.setup()

    // The nested subsection heading renders as an <h3> and its body shows.
    const subheading = screen.getByRole('heading', {
      level: 3,
      name: 'A nested subsection',
    })
    expect(subheading).toBeInTheDocument()
    expect(
      screen.getByText('A paragraph inside the subsection.'),
    ).toBeInTheDocument()

    // The subheading is clickable and opens the inspector with its provenance.
    await user.click(
      screen.getByRole('button', { name: 'A nested subsection' }),
    )
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Section heading',
        transformedText: 'A nested subsection',
        sourceBlockIds: ['b9'],
      }),
    )
  })

  it('renders an error chip for an untraceable block and does not make it clickable', () => {
    renderArticleView(vi.fn())
    const broken = screen.getByText('This paragraph has no source.')
    expect(broken).toBeInTheDocument()
    // The missing-source chip is shown…
    expect(screen.getByText('missing source reference')).toBeInTheDocument()
    // …and the broken paragraph is a plain <p>, not a clickable <button>.
    expect(broken.closest('button')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /This paragraph has no source/ }),
    ).toBeNull()
  })

  // --- DET-272: inline callout placement -----------------------------------

  it('renders a placed callout beside its section with a kind label (DET-272)', () => {
    const { container } = renderArticleView(vi.fn())
    // The placed caveat is rendered inside the section wrapper that owns the
    // section's DOM id (the anchor target), in the margin-note rail.
    const wrap = container.querySelector('#s1.tf-section-wrap')
    expect(wrap).toBeInTheDocument()
    const rail = wrap?.querySelector('.tf-callout-rail')
    expect(rail).toBeInTheDocument()
    // The placed caveat's text renders inside the rail (margin note).
    expect(rail?.textContent).toContain('A placed caveat beside the section.')
    // The small-caps kind label is present (two: the rail note + the index row).
    expect(screen.getAllByText('Caveat').length).toBeGreaterThan(0)
  })

  it('a placed callout is clickable → onInspect with its sourceBlockIds and kind', async () => {
    const onInspect = vi.fn()
    renderArticleView(onInspect)
    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', {
        name: /A placed caveat beside the section\./,
      }),
    )
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Caveat',
        transformedText: 'A placed caveat beside the section.',
        sourceBlockIds: ['b2'],
      }),
    )
  })

  it('renders the compact end index with an anchor link back to the section (DET-272)', () => {
    const { container } = renderArticleView(vi.fn())
    expect(
      screen.getByRole('heading', { level: 3, name: 'Index' }),
    ).toBeInTheDocument()
    // The index links back to the placed callout's section via #section-id.
    const link = container.querySelector('a.tf-callout-index-link')
    expect(link).toBeInTheDocument()
    expect(link?.getAttribute('href')).toBe('#s1')
  })

  it('renders the unplaced fallback group in full (DET-272)', () => {
    renderArticleView(vi.fn())
    expect(
      screen.getByRole('heading', { level: 3, name: 'Notes' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('An unplaced example with nowhere inline to live.'),
    ).toBeInTheDocument()
  })

  it('no longer renders the old terminal end-matter sections or the caveat pull-quote (DET-272)', () => {
    const { container } = renderArticleView(vi.fn())
    // The old full sections are replaced by the compact index.
    expect(
      screen.queryByRole('heading', { name: 'Important caveats' }),
    ).toBeNull()
    expect(
      screen.queryByRole('heading', { name: 'Source examples' }),
    ).toBeNull()
    // The only pull-quote left is the first-class generator block (b5); no
    // caveat-sourced pull-quote is injected mid-article anymore.
    const pullQuotes = container.querySelectorAll('.tf-pullquote')
    expect(pullQuotes).toHaveLength(1)
    expect(pullQuotes[0].textContent).toContain('A pulled excerpt.')
  })
})
