import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type {
  ArticleSectionV2,
  LearningConceptCandidate,
  LearningLayer,
  MisconceptionCandidate,
  RetrievalPromptCandidate,
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

  it('a validated candidate with a conceptId links to its inbox concept', () => {
    renderPanel({
      concepts: [],
      retrievalPrompts: [],
      conceptCandidates: [
        candidate({ validationStatus: 'validated', conceptId: 'con-1' }),
      ],
    })
    // Validation created a real "to learn" concept in the capture inbox; the
    // candidate now points at it instead of offering Validate again.
    const link = screen.getByRole('link', { name: /in inbox/i })
    expect(link).toHaveAttribute('href', '/inbox/con-1')
    expect(screen.queryByRole('button', { name: 'Validate' })).toBeNull()
  })
})

/**
 * DET-353 retrieval-prompt + misconception rendering. The panel renders the richer
 * `retrievalPromptCandidates` (question + type/difficulty + expected-answer refs)
 * and `misconceptions` (wrong belief + correction), each plainly AI-suggested, and
 * opens the inspector at the grounding blocks when its refs button is clicked.
 */
function prompt(
  over: Partial<RetrievalPromptCandidate> = {},
): RetrievalPromptCandidate {
  return {
    id: 'rp1',
    question: 'What is a system?',
    expectedAnswerSourceBlockIds: ['b1', 'b2'],
    relatedConceptCandidateIds: [],
    promptType: 'definition',
    difficulty: 'easy',
    status: 'ai_suggested',
    ...over,
  }
}

function misconception(
  over: Partial<MisconceptionCandidate> = {},
): MisconceptionCandidate {
  return {
    id: 'm1',
    misconception: 'A closed system exchanges nothing.',
    correction: 'A closed system still exchanges energy, just not matter.',
    sourceBlockIds: ['b3'],
    relatedConceptCandidateIds: [],
    confidence: 0.8,
    status: 'ai_suggested',
    ...over,
  }
}

describe('LearningToolsPanel retrieval prompts + misconceptions (DET-353)', () => {
  it('renders active-recall prompts with their question, type and difficulty', () => {
    renderPanel({
      concepts: [],
      retrievalPrompts: [],
      retrievalPromptCandidates: [prompt()],
    })
    expect(
      screen.getByRole('heading', { name: 'Active recall prompts' }),
    ).toBeInTheDocument()
    expect(screen.getByText('What is a system?')).toBeInTheDocument()
    expect(screen.getByText('definition')).toBeInTheDocument()
    expect(screen.getByText('easy')).toBeInTheDocument()
  })

  it("a prompt's expected-answer refs open the inspector with its grounding blocks", async () => {
    const onInspect = vi.fn()
    renderPanel(
      {
        concepts: [],
        retrievalPrompts: [],
        retrievalPromptCandidates: [prompt()],
      },
      onInspect,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /expected answer/ }))
    expect(onInspect).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Retrieval prompt',
        sourceBlockIds: ['b1', 'b2'],
      }),
    )
  })

  it('renders a grounded misconception with its correction and an AI-suggested chip', () => {
    renderPanel({
      concepts: [],
      retrievalPrompts: [],
      misconceptions: [misconception()],
    })
    expect(
      screen.getByRole('heading', { name: 'Misconceptions to watch for' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('A closed system exchanges nothing.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/still exchanges energy/)).toBeInTheDocument()
    expect(screen.getByText('AI-suggested')).toBeInTheDocument()
    // Grounded ⇒ it offers a source-refs button.
    expect(
      screen.getByRole('button', { name: /source refs/ }),
    ).toBeInTheDocument()
  })

  it('marks an ungrounded misconception as general, with no source-refs button', () => {
    renderPanel({
      concepts: [],
      retrievalPrompts: [],
      misconceptions: [misconception({ sourceBlockIds: [] })],
    })
    expect(
      screen.getByText('general — not from your source'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /source refs/ })).toBeNull()
  })
})
