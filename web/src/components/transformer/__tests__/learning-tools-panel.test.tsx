import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type {
  ArticleSectionV2,
  LearningConceptCandidate,
  LearningLayer,
} from '@/lib/api'
import { LearningToolsPanel } from '../learning-tools-panel'
import type { InspectorSelection } from '../source-inspector-panel'

/**
 * DET-283 learning-panel candidate rendering. We render the panel with a layer
 * that carries `conceptCandidates` and assert each renders with the always-visible
 * "AI-assisted · unvalidated" badge for pending items, groups under its section,
 * and opens the inspector with its sourceBlockIds when clicked.
 */

const sections: ArticleSectionV2[] = [
  {
    id: 's1',
    heading: 'Concepts section',
    headingSource: 'original',
    sourceBlockIds: ['b1'],
    blocks: [],
  },
]

function candidate(
  over: Partial<LearningConceptCandidate> = {},
): LearningConceptCandidate {
  return {
    id: 'cc1',
    sectionId: 's1',
    label: 'A candidate concept',
    definition: 'Its source-grounded definition.',
    sourceBlockIds: ['b1', 'b2'],
    aiAssisted: true,
    validationStatus: 'pending',
    ...over,
  }
}

function renderPanel(
  layer: LearningLayer,
  onInspect: (s: InspectorSelection) => void = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(
    <LearningToolsPanel
      articleId='art-1'
      layer={layer}
      sections={sections}
      onInspect={onInspect}
    />,
    { wrapper },
  )
}

describe('LearningToolsPanel concept candidates (DET-283)', () => {
  it('renders a pending candidate with the AI-assisted · unvalidated badge under its section', () => {
    renderPanel({
      concepts: [],
      retrievalPrompts: [],
      conceptCandidates: [candidate()],
    })
    expect(
      screen.getByRole('heading', { name: 'Concept candidates' }),
    ).toBeInTheDocument()
    expect(screen.getByText('A candidate concept')).toBeInTheDocument()
    expect(screen.getByText('AI-assisted · unvalidated')).toBeInTheDocument()
    // The section grouping links back to the section anchor.
    const link = screen.getByRole('link', { name: 'Concepts section' })
    expect(link.getAttribute('href')).toBe('#s1')
  })

  it('a candidate opens the inspector with its sourceBlockIds', async () => {
    const onInspect = vi.fn()
    renderPanel(
      {
        concepts: [],
        retrievalPrompts: [],
        conceptCandidates: [candidate()],
      },
      onInspect,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /source refs/ }))
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Concept candidate',
        sourceBlockIds: ['b1', 'b2'],
      }),
    )
  })

  it('a non-pending candidate shows its status, not the unvalidated badge', () => {
    renderPanel({
      concepts: [],
      retrievalPrompts: [],
      conceptCandidates: [candidate({ validationStatus: 'validated' })],
    })
    expect(screen.queryByText('AI-assisted · unvalidated')).toBeNull()
    expect(screen.getByText('validated')).toBeInTheDocument()
  })
})
