import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArticleJsonV3 } from '@/lib/article-v3'

import { ArticleReviewPanels } from '../article-review-panels'

/**
 * DET-359: the v3 reader's review surface. These tests pin the fix for the prior
 * verification failure — that review interactions are REACHABLE on the v3 reader
 * and land on the v3-review endpoints (not the dead v2 path). We render the panel
 * over an Article JSON v3 body and assert accept/answer fire the right API call,
 * plus the blocked / empty states.
 */

const setV3ConceptReview = vi.fn().mockResolvedValue({})
const setV3PromptReview = vi.fn().mockResolvedValue({})

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  api: {
    setV3ConceptReview: (...args: unknown[]) => setV3ConceptReview(...args),
    setV3PromptReview: (...args: unknown[]) => setV3PromptReview(...args),
  },
}))

function article(): Pick<ArticleJsonV3, 'keyConcepts' | 'retrievalPrompts'> {
  return {
    keyConcepts: [
      {
        id: 'kc1',
        name: 'Photosynthesis',
        normalizedName: 'photosynthesis',
        type: 'core_concept',
        shortDefinition: 'How plants turn light into energy.',
        sourceBlockIds: ['b1'],
        articleSectionIds: ['s1'],
        importance: 'high',
        suggestedCognitiveState: 'Seen',
        status: 'ai_suggested',
      },
    ],
    retrievalPrompts: [
      {
        id: 'rp1',
        question: 'What does photosynthesis convert?',
        expectedAnswerSourceBlockIds: ['b1'],
        relatedConceptCandidateIds: ['kc1'],
        promptType: 'definition',
        difficulty: 'easy',
        status: 'ai_suggested',
      },
    ],
  }
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof ArticleReviewPanels>> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ArticleReviewPanels
        articleId='a1'
        article={article()}
        state='ready'
        {...props}
      />
    </QueryClientProvider>,
  )
}

describe('ArticleReviewPanels (DET-359, v3 reader)', () => {
  beforeEach(() => {
    setV3ConceptReview.mockClear()
    setV3PromptReview.mockClear()
  })

  it('renders the concepts + prompts straight from the v3 article body', () => {
    renderPanel()
    const concepts = screen.getByRole('region', { name: 'Concept candidates' })
    expect(within(concepts).getByText('Photosynthesis')).toBeInTheDocument()
    expect(
      screen.getByText('What does photosynthesis convert?'),
    ).toBeInTheDocument()
  })

  it('accepting a concept calls the v3 concept-review endpoint', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(setV3ConceptReview).toHaveBeenCalledWith('a1', 'kc1', {
      status: 'accepted',
    })
  })

  it('rejecting a concept calls the v3 concept-review endpoint', async () => {
    const user = userEvent.setup()
    renderPanel()
    const concepts = screen.getByRole('region', { name: 'Concept candidates' })
    await user.click(within(concepts).getByRole('button', { name: 'Reject' }))
    expect(setV3ConceptReview).toHaveBeenCalledWith('a1', 'kc1', {
      status: 'rejected',
    })
  })

  it('answering a prompt persists the answer (the scheduling gate)', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Answer now' }))
    await user.type(
      screen.getByLabelText('Your answer'),
      'Light into chemical energy.',
    )
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(setV3PromptReview).toHaveBeenCalledWith('a1', 'rp1', {
      status: 'answered',
      userAnswer: 'Light into chemical energy.',
    })
  })

  it('saving a prompt keeps a suggestion (does NOT schedule)', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'Save as suggested' }))
    expect(setV3PromptReview).toHaveBeenCalledWith('a1', 'rp1', {
      status: 'saved',
    })
  })

  it('shows a blocked state and offers no actions when the article is blocked', () => {
    renderPanel({ state: 'blocked' })
    expect(
      screen.getByText(/held back by the fidelity check/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('renders an empty state when the article suggested nothing', () => {
    renderPanel({ article: { keyConcepts: [], retrievalPrompts: [] } })
    expect(
      screen.getByText(/no concept candidates or retrieval prompts/i),
    ).toBeInTheDocument()
  })
})
