import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { RetrievalPromptV3 } from '@/lib/article-learning-review'
import {
  type RetrievalPromptActions,
  RetrievalPromptsReviewPanel,
} from '../retrieval-prompts-review-panel'

/**
 * DET-359 retrieval prompts review panel. Verifies type grouping, linked-concept
 * chips, the answer/save/reject/edit actions, and the scheduling gate: a prompt
 * is shown as "ready to keep" ONLY after the reader authors an answer — saving
 * keeps a suggestion and never schedules.
 */

function prompt(over: Partial<RetrievalPromptV3> = {}): RetrievalPromptV3 {
  return {
    id: 'p1',
    prompt: 'What is photosynthesis?',
    type: 'recall',
    linkedConceptIds: [],
    expectedAnswerBlockIds: ['b1', 'b2'],
    status: 'suggested',
    sourceBlockIds: ['b1', 'b2'],
    ...over,
  }
}

function noopActions(
  over: Partial<RetrievalPromptActions> = {},
): RetrievalPromptActions {
  return {
    onAnswer: vi.fn(),
    onSave: vi.fn(),
    onReject: vi.fn(),
    onEdit: vi.fn(),
    ...over,
  }
}

describe('RetrievalPromptsReviewPanel', () => {
  it('renders an empty state when there are no prompts', () => {
    render(<RetrievalPromptsReviewPanel prompts={[]} actions={noopActions()} />)
    expect(screen.getByText(/no retrieval prompts yet/i)).toBeInTheDocument()
  })

  it('groups by type and shows linked concept labels + expected-answer refs', () => {
    render(
      <RetrievalPromptsReviewPanel
        prompts={[
          prompt({ id: 'a', type: 'application', linkedConceptIds: ['cc1'] }),
        ]}
        conceptLabels={{ cc1: 'Photosynthesis' }}
        actions={noopActions()}
      />,
    )
    expect(screen.getByText('Application')).toBeInTheDocument()
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /expected answer \(2 source blocks\)/,
      }),
    ).toBeInTheDocument()
  })

  it('save and reject persist via callbacks', async () => {
    const actions = noopActions()
    render(
      <RetrievalPromptsReviewPanel prompts={[prompt()]} actions={actions} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Save as suggested' }))
    expect(actions.onSave).toHaveBeenCalledWith('p1')
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(actions.onReject).toHaveBeenCalledWith('p1')
  })

  it('answering now submits the reader’s own-words answer', async () => {
    const actions = noopActions()
    render(
      <RetrievalPromptsReviewPanel prompts={[prompt()]} actions={actions} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Answer now' }))
    await user.type(screen.getByLabelText('Your answer'), 'My explanation')
    await user.click(screen.getByRole('button', { name: 'Submit answer' }))
    expect(actions.onAnswer).toHaveBeenCalledWith('p1', 'My explanation')
  })

  it('shows the "ready to keep as a review card" gate only once answered', () => {
    const { rerender } = render(
      <RetrievalPromptsReviewPanel
        prompts={[prompt({ status: 'saved' })]}
        actions={noopActions()}
      />,
    )
    // Saved is NOT scheduled — no ready affordance.
    expect(screen.queryByText(/ready to keep as a review card/i)).toBeNull()

    rerender(
      <RetrievalPromptsReviewPanel
        prompts={[prompt({ status: 'answered', userAnswer: 'mine' })]}
        actions={noopActions()}
      />,
    )
    expect(
      screen.getByText(/ready to keep as a review card/i),
    ).toBeInTheDocument()
  })

  it('editing saves the revised prompt text', async () => {
    const actions = noopActions()
    render(
      <RetrievalPromptsReviewPanel prompts={[prompt()]} actions={actions} />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const field = screen.getByLabelText('Prompt text')
    await user.clear(field)
    await user.type(field, 'Revised prompt?')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.onEdit).toHaveBeenCalledWith('p1', 'Revised prompt?')
  })
})
