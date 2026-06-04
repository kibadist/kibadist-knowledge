import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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

  it('renders something readable for every ArticleBlock union member', () => {
    renderArticleView(vi.fn())
    // paragraph
    expect(
      screen.getByText('A clickable source-grounded paragraph.'),
    ).toBeInTheDocument()
    // list (items joined by the W1 fallback renderer)
    expect(screen.getByText(/First step/)).toBeInTheDocument()
    expect(screen.getByText(/Second step/)).toBeInTheDocument()
    // quote (with attribution)
    expect(screen.getByText(/A memorable line\./)).toBeInTheDocument()
    expect(screen.getByText(/Someone/)).toBeInTheDocument()
    // pullQuote
    expect(screen.getByText(/A pulled excerpt\./)).toBeInTheDocument()
    // table (caption + header + rows flattened)
    expect(screen.getByText(/A small table/)).toBeInTheDocument()
    // code
    expect(screen.getByText(/const x = 1/)).toBeInTheDocument()
    // figureAnchor (caption)
    expect(screen.getByText('A figure caption.')).toBeInTheDocument()
    // callout (title: text)
    expect(screen.getByText(/A callout body\./)).toBeInTheDocument()
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
})
