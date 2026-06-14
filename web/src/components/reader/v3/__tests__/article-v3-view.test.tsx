import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ArticleV3View } from '../article-v3-view'
import {
  blockedArticleV3,
  conceptExplainerV3,
  lessonArticleV3,
} from './article-v3-view.fixtures'

/**
 * Article JSON v3 reader tests (DET-357). No network — rendered against in-repo
 * fixtures only. Snapshot tests cover the two canonical shapes (lesson article +
 * concept explainer); behaviour tests assert the acceptance criteria: required
 * sections/panels render, blocked articles surface blocker reasons + hints,
 * concepts/prompts are visible but not auto-accepted, references stay out of the
 * body, and AI scaffolding is visually distinct from source-grounded claims.
 */

describe('ArticleV3View — snapshots', () => {
  it('renders the v3 lesson article', () => {
    const { container } = render(<ArticleV3View article={lessonArticleV3} />)
    expect(container).toMatchSnapshot()
  })

  it('renders the v3 concept explainer', () => {
    const { container } = render(<ArticleV3View article={conceptExplainerV3} />)
    expect(container).toMatchSnapshot()
  })
})

describe('ArticleV3View — required sections and panels', () => {
  it('renders title, dek, source-kind badge, shape and reading time', () => {
    render(<ArticleV3View article={lessonArticleV3} />)
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'How a Transformer Block Works',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/The instructor walks through attention/),
    ).toBeInTheDocument()
    expect(screen.getByText('Lesson transcript')).toBeInTheDocument()
    expect(screen.getByText('Lesson')).toBeInTheDocument()
    expect(screen.getByText('7 min read')).toBeInTheDocument()
  })

  it('renders the learning path', () => {
    render(<ArticleV3View article={lessonArticleV3} />)
    expect(
      screen.getByRole('heading', { name: "What you'll learn" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('How attention routes information'),
    ).toBeInTheDocument()
  })

  it('renders main sections, subsections and a source-grounded table', () => {
    const { container } = render(<ArticleV3View article={lessonArticleV3} />)
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Attention routes information',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Why a non-linearity?' }),
    ).toBeInTheDocument()
    // The MLP table renders inline (related to the s-mlp section).
    const table = container.querySelector('table.av3-table')
    expect(table).toBeInTheDocument()
    expect(within(table as HTMLElement).getByText('Expand')).toBeInTheDocument()
  })

  it('renders an inline source-grounded callout beside its section', () => {
    render(<ArticleV3View article={lessonArticleV3} />)
    expect(screen.getByText('Attention as a mixer')).toBeInTheDocument()
    expect(screen.getAllByText('Analogy').length).toBeGreaterThan(0)
  })

  it('renders the key concepts and retrieval prompts panels', () => {
    render(<ArticleV3View article={lessonArticleV3} />)
    expect(
      screen.getByRole('heading', { name: 'Key concepts' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Attention')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Retrieval prompts' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/What do the query, key, and value vectors/),
    ).toBeInTheDocument()
  })

  it('renders the source notes drawer and quality report drawer', () => {
    render(<ArticleV3View article={lessonArticleV3} />)
    expect(screen.getByText(/Source notes & references/)).toBeInTheDocument()
    expect(screen.getByText('Quality report')).toBeInTheDocument()
  })
})

describe('ArticleV3View — status', () => {
  it('shows a READY_FOR_REVIEW confirmation for a passed article', () => {
    render(<ArticleV3View article={lessonArticleV3} />)
    expect(screen.getByText('Ready for review')).toBeInTheDocument()
  })

  it('shows blocker reasons and regeneration hints for a blocked article', () => {
    render(<ArticleV3View article={blockedArticleV3} />)
    const banner = screen.getByRole('alert')
    expect(
      within(banner).getByText(/Blocked · low coverage/),
    ).toBeInTheDocument()
    expect(within(banner).getByText("Why it's blocked")).toBeInTheDocument()
    expect(
      within(banner).getByText(/Only 41% of high-importance source blocks/),
    ).toBeInTheDocument()
    expect(within(banner).getByText('How to fix it')).toBeInTheDocument()
    expect(
      within(banner).getByText(/Re-run the outline stage/),
    ).toBeInTheDocument()
  })

  it('prefers the status prop over the article JSON status', () => {
    // The record status overrides the embedded JSON status (regeneration flow).
    render(
      <ArticleV3View article={lessonArticleV3} status='BLOCKED_FIDELITY' />,
    )
    expect(screen.getByText('Blocked · fidelity')).toBeInTheDocument()
    expect(screen.queryByText('Ready for review')).toBeNull()
  })
})

describe('ArticleV3View — learning-first invariants', () => {
  it('keeps references out of the body and in the source notes drawer', () => {
    const { container } = render(<ArticleV3View article={lessonArticleV3} />)
    const body = container.querySelector('.av3-body') as HTMLElement
    expect(within(body).queryByText(/Attention Is All You Need/)).toBeNull()
    const drawer = container.querySelector('.av3-drawer') as HTMLElement
    expect(
      within(drawer).getByText(/Attention Is All You Need/),
    ).toBeInTheDocument()
  })

  it('marks concept candidates as AI-suggested and not yet accepted', () => {
    render(<ArticleV3View article={lessonArticleV3} />)
    expect(
      screen.getByText(/AI-suggested · not yet accepted/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/AI-suggested · not yet scheduled/),
    ).toBeInTheDocument()
  })

  it('renders AI scaffolding visually distinct from source-grounded prose', () => {
    const { container } = render(<ArticleV3View article={lessonArticleV3} />)
    const ai = container.querySelector('.av3-paragraph--ai')
    expect(ai).toBeInTheDocument()
    expect(ai?.textContent).toContain('soft lookup table')
    // The AI-assisted chip is present and the paragraph is NOT a clickable
    // source-inspection button (ungrounded prose can't open the inspector).
    expect(ai?.querySelector('.av3-ai-chip')).toBeInTheDocument()
    expect(ai?.tagName).toBe('P')
  })

  it('opens the inspector from a source-grounded paragraph with its source blocks', () => {
    const onInspect = vi.fn()
    render(<ArticleV3View article={lessonArticleV3} onInspect={onInspect} />)
    const para = screen.getByText(/Each token emits a query/)
    fireEvent.click(para.closest('button') as HTMLButtonElement)
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Paragraph',
        sourceBlockIds: ['b2'],
      }),
    )
  })

  it('opens the inspector from a source-grounded table', () => {
    const onInspect = vi.fn()
    render(<ArticleV3View article={lessonArticleV3} onInspect={onInspect} />)
    const table = screen
      .getByText('Stages of the MLP')
      .closest('button') as HTMLButtonElement
    fireEvent.click(table)
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'Table', sourceBlockIds: ['b4'] }),
    )
  })
})
