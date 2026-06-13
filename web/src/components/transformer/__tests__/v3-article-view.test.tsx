import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ArticleJsonV3, QualityReport } from '@/lib/article-v3'

import { V3ArticleView } from '../v3/v3-article-view'

/**
 * DET-343 v3 reader surface. This is the wiring that makes a Source-Grounded
 * Learning Article renderable in the Read page — the gap that failed browser
 * verification (the body was unrenderable; the learning panel was orphaned).
 * These tests assert both halves render and that AI scaffolding is visibly
 * distinct from source-grounded content.
 */

function article(overrides: Partial<ArticleJsonV3> = {}): ArticleJsonV3 {
  return {
    schemaVersion: 'v3',
    sourceKind: 'transcript',
    shape: 'lesson',
    title: { text: 'How the heap stores objects', provenance: 'scaffold' },
    summary: {
      text: 'A short lesson on heap allocation.',
      provenance: 'source',
    },
    sections: [
      {
        id: 'sec-0',
        heading: 'Allocation',
        headingProvenance: 'source',
        sourceBlockIds: ['b1'],
        blocks: [
          {
            id: 'blk-source',
            type: 'paragraph',
            text: 'Objects are allocated on the heap and outlive the stack frame.',
            sourceBlockIds: ['b1'],
            provenance: 'source',
            fidelityRisk: 'low',
          },
          {
            id: 'blk-scaffold',
            type: 'callout',
            text: 'In short: the heap is for things that need to live longer.',
            sourceBlockIds: [],
            provenance: 'scaffold',
            fidelityRisk: 'medium',
          },
          {
            id: 'blk-list',
            type: 'list',
            text: 'Two costs of heap allocation',
            sourceBlockIds: ['b2'],
            provenance: 'source',
            fidelityRisk: 'low',
            items: ['Bookkeeping overhead', 'Garbage-collection pressure'],
          },
        ],
      },
    ],
    learning: {
      learningPath: [
        {
          id: 'lp-0',
          objective: 'Explain how the heap stores objects',
          sectionIds: ['sec-0'],
        },
      ],
      keyConcepts: [
        {
          id: 'concept-0',
          label: 'Heap',
          definition: 'A region of memory where objects live.',
          sourceBlockIds: ['b1'],
          aiAssisted: true,
        },
      ],
      keyClaims: [
        {
          id: 'claim-0',
          text: 'Objects outlive the stack frame.',
          sourceBlockIds: ['b1'],
          support: 'grounded',
        },
      ],
      retrievalPrompts: [
        {
          id: 'prompt-0',
          prompt: 'Where do allocated objects live?',
          sourceBlockIds: ['b1'],
        },
      ],
      sourceNotes: [],
    },
    provenance: {
      totalBlocks: 3,
      sourceGroundedBlocks: 2,
      scaffoldBlocks: 1,
      groundedPercent: 67,
    },
    ...overrides,
  }
}

const quality: QualityReport = {
  status: 'READY_FOR_REVIEW',
  sourceKind: 'transcript',
  importantCoveragePercent: 88,
  importantCoverageThreshold: 80,
  unsupportedClaimCount: 0,
  conceptCandidateCount: 1,
  retrievalPromptCount: 1,
  exerciseReadiness: 72,
  groundedPercent: 67,
  blockers: [],
}

describe('V3ArticleView (DET-343)', () => {
  it('renders the source-grounded article body on the Article surface', () => {
    render(
      <V3ArticleView article={article()} quality={quality} surface='article' />,
    )
    expect(screen.getByText('How the heap stores objects')).toBeInTheDocument()
    expect(screen.getByText('Allocation')).toBeInTheDocument()
    expect(
      screen.getByText(/Objects are allocated on the heap/),
    ).toBeInTheDocument()
    // List blocks render their items.
    expect(screen.getByText('Bookkeeping overhead')).toBeInTheDocument()
    expect(screen.getByText('Garbage-collection pressure')).toBeInTheDocument()
  })

  it('makes AI scaffolding visibly distinct from source-grounded content', () => {
    const { container } = render(
      <V3ArticleView article={article()} quality={quality} surface='article' />,
    )
    // The scaffold block carries the "not from your source" AI marker and the
    // is-scaffold class; the source block is marked as coming from the source.
    const scaffold = container.querySelector('[data-provenance="scaffold"]')
    expect(scaffold).not.toBeNull()
    expect(scaffold).toHaveClass('is-scaffold')
    expect(
      within(scaffold as HTMLElement).getByText(/not from your source/),
    ).toBeInTheDocument()

    const source = container.querySelector(
      '.tf-v3-block[data-provenance="source"]',
    )
    expect(source).not.toBeNull()
    expect(source).toHaveClass('is-source')
    expect(
      within(source as HTMLElement).getByText('From your source'),
    ).toBeInTheDocument()
  })

  it('renders the learning layer (path, concepts, prompts) alongside the body', () => {
    render(
      <V3ArticleView article={article()} quality={quality} surface='article' />,
    )
    expect(screen.getByText('Learning path')).toBeInTheDocument()
    expect(
      screen.getByText('Explain how the heap stores objects'),
    ).toBeInTheDocument()
    expect(screen.getByText('Key concepts')).toBeInTheDocument()
    expect(
      screen.getByText('Where do allocated objects live?'),
    ).toBeInTheDocument()
  })

  it('shows the quality verdict and coverage from the report', () => {
    render(
      <V3ArticleView article={article()} quality={quality} surface='article' />,
    )
    expect(screen.getByText('Ready for review')).toBeInTheDocument()
    expect(screen.getByText(/88% important coverage/)).toBeInTheDocument()
  })

  it('leads with the learning layer on the Exercise surface', () => {
    render(
      <V3ArticleView
        article={article()}
        quality={quality}
        surface='exercise'
      />,
    )
    // The retrieval prompts (the active-recall material) are present, and the
    // body is folded behind a re-read disclosure rather than leading.
    expect(
      screen.getByText('Where do allocated objects live?'),
    ).toBeInTheDocument()
    expect(screen.getByText('Read the full article again')).toBeInTheDocument()
  })
})
