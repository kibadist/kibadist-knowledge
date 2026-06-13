import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ConceptCandidateV3 } from '@/lib/article-v3'
import {
  type ConceptCandidateActions,
  ConceptCandidatesReviewPanel,
} from '../concept-candidates-review-panel'

/**
 * DET-359 concept candidates review panel. Verifies importance grouping, the
 * source-backed definition + span preview render, the accept/reject/edit/defer
 * actions persist via callbacks, and — critically — that "accepted" is shown as
 * a user-review state (never "learned"), and an empty list renders an empty
 * state.
 */

function candidate(over: Partial<ConceptCandidateV3> = {}): ConceptCandidateV3 {
  return {
    id: 'c1',
    label: 'Photosynthesis',
    importance: 'high',
    definition: 'How plants turn light into energy.',
    sourceSpanPreview: 'Plants convert sunlight…',
    sourceBlockIds: ['b1', 'b2'],
    status: 'pending',
    ...over,
  }
}

function noopActions(
  over: Partial<ConceptCandidateActions> = {},
): ConceptCandidateActions {
  return {
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onEdit: vi.fn(),
    onDefer: vi.fn(),
    ...over,
  }
}

describe('ConceptCandidatesReviewPanel', () => {
  it('renders an empty state when there are no candidates', () => {
    render(
      <ConceptCandidatesReviewPanel candidates={[]} actions={noopActions()} />,
    )
    expect(screen.getByText(/no concept candidates yet/i)).toBeInTheDocument()
  })

  it('groups by importance and shows the definition + source span preview', () => {
    render(
      <ConceptCandidatesReviewPanel
        candidates={[
          candidate({
            id: 'a',
            importance: 'high',
            label: 'High one',
            definition: 'High definition.',
          }),
          candidate({
            id: 'b',
            importance: 'low',
            label: 'Low one',
            definition: 'Low definition.',
          }),
        ]}
        actions={noopActions()}
      />,
    )
    expect(screen.getByText('High importance')).toBeInTheDocument()
    expect(screen.getByText('Low importance')).toBeInTheDocument()
    expect(screen.getByText('High definition.')).toBeInTheDocument()
    // The span preview (shared default) renders for both candidates.
    expect(screen.getAllByText(/Plants convert sunlight/)).toHaveLength(2)
  })

  it('accept and reject call their callbacks with the candidate id', async () => {
    const actions = noopActions()
    render(
      <ConceptCandidatesReviewPanel
        candidates={[candidate()]}
        actions={actions}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    expect(actions.onAccept).toHaveBeenCalledWith('c1')
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(actions.onReject).toHaveBeenCalledWith('c1')
  })

  it('shows an accepted candidate as a user-review state, never "learned"', () => {
    render(
      <ConceptCandidatesReviewPanel
        candidates={[candidate({ status: 'accepted' })]}
        actions={noopActions()}
      />,
    )
    expect(screen.getByText('In review · not yet learned')).toBeInTheDocument()
    // Accept is no longer offered once accepted.
    expect(
      (screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('edit opens inline fields and saves the revised label + definition', async () => {
    const actions = noopActions()
    render(
      <ConceptCandidatesReviewPanel
        candidates={[candidate()]}
        actions={actions}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const label = screen.getByLabelText('Concept label')
    await user.clear(label)
    await user.type(label, 'Edited label')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.onEdit).toHaveBeenCalledWith('c1', {
      label: 'Edited label',
      definition: 'How plants turn light into energy.',
    })
  })

  it('"Create Living Concept later" defers without accepting', async () => {
    const actions = noopActions()
    render(
      <ConceptCandidatesReviewPanel
        candidates={[candidate()]}
        actions={actions}
      />,
    )
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Create Living Concept later' }),
    )
    expect(actions.onDefer).toHaveBeenCalledWith('c1')
    expect(actions.onAccept).not.toHaveBeenCalled()
  })

  it('an accepted candidate with a conceptId links to the review queue', () => {
    render(
      <ConceptCandidatesReviewPanel
        candidates={[candidate({ status: 'accepted', conceptId: 'con-1' })]}
        actions={noopActions()}
      />,
    )
    const link = screen.getByRole('link', { name: /review queue/i })
    expect(link).toHaveAttribute('href', '/inbox/con-1')
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})
