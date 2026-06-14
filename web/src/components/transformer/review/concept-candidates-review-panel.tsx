'use client'

import { useState } from 'react'

import {
  type ConceptCandidateV3,
  groupCandidatesByImportance,
  IMPORTANCE_LABEL,
} from '@/lib/article-learning-review'

/**
 * Concept candidates review panel (DET-359). Lists AI-suggested concepts grouped
 * by High → Medium → Low importance. Each candidate shows a source-backed short
 * definition, a source-span preview, and the actions: Accept, Reject, Edit, and
 * "Create Living Concept later". The panel is presentational — it owns only the
 * inline-edit draft; every persisting action is delegated to a callback so the
 * page can wire it to the API and tests can render it without a network.
 *
 * INVARIANT (DET-359): accepting a candidate moves it to a USER-REVIEW state — a
 * chip says so explicitly — and never internalizes it as permanent knowledge.
 * Once accepted with a created review concept, the card links to it instead of
 * offering Accept again.
 */

const STATUS_CHIP: Record<
  ConceptCandidateV3['status'],
  { label: string; className: string }
> = {
  pending: { label: 'AI-suggested · not reviewed', className: 'chip-ai' },
  accepted: { label: 'In review · not yet learned', className: 'chip-pending' },
  rejected: { label: 'rejected', className: 'chip-quiet' },
  deferred: { label: 'saved for later', className: 'chip-info' },
}

export interface ConceptCandidateActions {
  /** Accept → move to user-review state (never internalized). */
  onAccept: (id: string) => void
  onReject: (id: string) => void
  onEdit: (id: string, edit: { label: string; definition: string }) => void
  /** "Create Living Concept later" — keep around, decide later. */
  onDefer: (id: string) => void
}

export function ConceptCandidatesReviewPanel({
  candidates,
  actions,
  busy = false,
  onInspect,
}: {
  candidates: ConceptCandidateV3[]
  actions: ConceptCandidateActions
  /** Disables every action while a mutation is in flight. */
  busy?: boolean
  /** Optional: open a source inspector for a candidate's source blocks. */
  onInspect?: (candidate: ConceptCandidateV3) => void
}) {
  if (candidates.length === 0) {
    return (
      <section
        className='tf-review tf-review--concepts'
        aria-label='Concept candidates'
      >
        <h3 className='tf-aux-h'>Concept candidates</h3>
        <p className='tf-review-empty block-sub'>
          No concept candidates yet. When the generator extracts concepts from
          this article, they’ll appear here for you to review.
        </p>
      </section>
    )
  }

  const groups = groupCandidatesByImportance(candidates)

  return (
    <section
      className='tf-review tf-review--concepts'
      aria-label='Concept candidates'
    >
      <h3 className='tf-aux-h'>Concept candidates</h3>
      <p className='tf-review-note block-sub'>
        AI-suggested concepts. Accepting one moves it to your review queue — it
        is never learned automatically.
      </p>
      {groups.map((group) => (
        <div key={group.importance} className='tf-review-group'>
          <h4
            className={`tf-review-group-h tf-importance tf-importance--${group.importance}`}
          >
            {IMPORTANCE_LABEL[group.importance]}
          </h4>
          <ul className='tf-review-list'>
            {group.candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                actions={actions}
                busy={busy}
                onInspect={onInspect}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function CandidateCard({
  candidate: c,
  actions,
  busy,
  onInspect,
}: {
  candidate: ConceptCandidateV3
  actions: ConceptCandidateActions
  busy: boolean
  onInspect?: (candidate: ConceptCandidateV3) => void
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(c.label)
  const [definition, setDefinition] = useState(c.definition)

  const chip = STATUS_CHIP[c.status]
  const decided = c.status === 'accepted' || c.status === 'rejected'

  if (editing) {
    const canSave = label.trim().length > 0 && definition.trim().length > 0
    return (
      <li className='tf-review-card tf-review-card--editing'>
        <label className='tf-review-edit-field'>
          <span className='tf-review-edit-label'>Concept</span>
          <input
            className='tf-review-edit-input'
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-label='Concept label'
          />
        </label>
        <label className='tf-review-edit-field'>
          <span className='tf-review-edit-label'>Definition</span>
          <textarea
            className='tf-review-edit-textarea'
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            aria-label='Concept definition'
            rows={3}
          />
        </label>
        <div className='tf-review-actions'>
          <button
            type='button'
            className='btn-ghost-xs'
            disabled={busy || !canSave}
            onClick={() => {
              actions.onEdit(c.id, {
                label: label.trim(),
                definition: definition.trim(),
              })
              setEditing(false)
            }}
          >
            Save
          </button>
          <button
            type='button'
            className='btn-ghost-xs'
            disabled={busy}
            onClick={() => {
              setLabel(c.label)
              setDefinition(c.definition)
              setEditing(false)
            }}
          >
            Cancel
          </button>
        </div>
      </li>
    )
  }

  return (
    <li
      className={`tf-review-card${c.status === 'rejected' ? ' is-dismissed' : ''}`}
    >
      <div className='tf-review-card-top'>
        <span className='tf-review-card-label'>{c.label}</span>
        <span className={`chip ${chip.className}`}>{chip.label}</span>
      </div>
      <p className='tf-review-card-def'>{c.definition}</p>
      {c.sourceSpanPreview && (
        <blockquote className='tf-review-span'>
          “{c.sourceSpanPreview}”
        </blockquote>
      )}
      <div className='tf-review-card-foot'>
        <button
          type='button'
          className='tf-ref-btn'
          disabled={!onInspect}
          onClick={() => onInspect?.(c)}
        >
          source refs ({c.sourceBlockIds.length})
        </button>
        <div className='tf-review-actions'>
          {c.conceptId ? (
            // Acceptance already created the user-review concept — link to it
            // rather than offering Accept again (acceptance is idempotent).
            <a className='tf-review-inbox-link' href={`/inbox/${c.conceptId}`}>
              In review queue →
            </a>
          ) : (
            <>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || c.status === 'accepted'}
                onClick={() => actions.onAccept(c.id)}
              >
                Accept
              </button>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || c.status === 'rejected'}
                onClick={() => actions.onReject(c.id)}
              >
                Reject
              </button>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || decided}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || decided}
                onClick={() => actions.onDefer(c.id)}
              >
                Create Living Concept later
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
