import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ArticleJsonV3, QualityReport } from '@/lib/article-v3'
import { V3LearningPanel } from '../v3/v3-learning-panel'

/**
 * DET-343 v3 learning + provenance panel. Renders the learning layer and the
 * quality-gate verdict, and makes source-grounded vs unsupported claims visibly
 * distinct.
 */

function article(overrides: Partial<ArticleJsonV3> = {}): ArticleJsonV3 {
  return {
    schemaVersion: 'v3',
    sourceKind: 'transcript',
    shape: 'lesson',
    title: { text: 'The heap', provenance: 'scaffold' },
    summary: { text: 'How memory works', provenance: 'scaffold' },
    sections: [],
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
        {
          id: 'claim-1',
          text: 'The heap is always faster.',
          sourceBlockIds: [],
          support: 'unsupported',
        },
      ],
      retrievalPrompts: [
        {
          id: 'prompt-0',
          prompt: 'Where do allocated objects live?',
          sourceBlockIds: ['b1'],
        },
      ],
      sourceNotes: [
        {
          id: 'note-0',
          text: 'The lesson assumes a GC language.',
          sourceBlockIds: ['b2'],
        },
      ],
    },
    provenance: {
      totalBlocks: 4,
      sourceGroundedBlocks: 3,
      scaffoldBlocks: 1,
      groundedPercent: 75,
    },
    ...overrides,
  }
}

const quality: QualityReport = {
  status: 'BLOCKED',
  sourceKind: 'transcript',
  importantCoveragePercent: 50,
  importantCoverageThreshold: 80,
  unsupportedClaimCount: 1,
  conceptCandidateCount: 1,
  retrievalPromptCount: 1,
  exerciseReadiness: 35,
  groundedPercent: 75,
  blockers: [
    {
      code: 'IMPORTANT_COVERAGE_BELOW_THRESHOLD',
      severity: 'hard',
      message: 'Important source coverage 50% is below the 80% floor.',
      refs: ['b3'],
    },
  ],
}

describe('V3LearningPanel (DET-343)', () => {
  it('renders the learning layer sections', () => {
    render(<V3LearningPanel article={article()} quality={null} />)
    expect(screen.getByText('Learning path')).toBeInTheDocument()
    expect(
      screen.getByText('Explain how the heap stores objects'),
    ).toBeInTheDocument()
    expect(screen.getByText('Heap')).toBeInTheDocument()
    expect(
      screen.getByText('Where do allocated objects live?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The lesson assumes a GC language.'),
    ).toBeInTheDocument()
  })

  it('distinguishes supported from unsupported claims', () => {
    render(<V3LearningPanel article={article()} quality={null} />)
    expect(screen.getByText('supported')).toBeInTheDocument()
    expect(screen.getByText('unsupported')).toBeInTheDocument()
  })

  it('shows the quality verdict, coverage vs threshold, and blockers', () => {
    render(<V3LearningPanel article={article()} quality={quality} />)
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.getByText(/50% important coverage/)).toBeInTheDocument()
    expect(screen.getByText(/floor 80%/)).toBeInTheDocument()
    expect(screen.getByText(/below the 80% floor/)).toBeInTheDocument()
  })

  it('shows the source-grounded percentage', () => {
    render(<V3LearningPanel article={article()} quality={null} />)
    expect(screen.getByText('75% source-grounded')).toBeInTheDocument()
  })
})
