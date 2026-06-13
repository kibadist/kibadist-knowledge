'use client'

import { useState } from 'react'

import {
  groupPromptsByType,
  promptAllowsScheduling,
  RETRIEVAL_TYPE_LABEL,
  type RetrievalPromptV3,
} from '@/lib/article-v3'

/**
 * Retrieval prompts review panel (DET-359). Shows AI-suggested prompts grouped
 * by type, each with its linked concepts and the source blocks holding the
 * expected answer. Actions: Answer now (author an answer inline), Save as
 * suggested, Reject, and Edit (revise the prompt text). Presentational — it owns
 * only the inline answer/edit drafts; persistence is delegated to callbacks.
 *
 * INVARIANT (DET-359): nothing here creates a permanent review card. Permanent
 * scheduling stays gated on a user-authored answer — only an `answered` prompt
 * shows the "ready to schedule" affordance (`promptAllowsScheduling`). "Save as
 * suggested" keeps a proposal; it does not schedule.
 */

const STATUS_CHIP: Record<
  RetrievalPromptV3['status'],
  { label: string; className: string }
> = {
  suggested: { label: 'AI-suggested', className: 'chip-ai' },
  saved: { label: 'saved as suggestion', className: 'chip-info' },
  answered: { label: 'answered', className: 'chip-cleared' },
  rejected: { label: 'rejected', className: 'chip-quiet' },
}

export interface RetrievalPromptActions {
  /** Persist the reader's own-words answer (the scheduling gate). */
  onAnswer: (id: string, answer: string) => void
  /** Keep as a suggestion — NOT scheduled. */
  onSave: (id: string) => void
  onReject: (id: string) => void
  onEdit: (id: string, prompt: string) => void
}

export function RetrievalPromptsReviewPanel({
  prompts,
  conceptLabels = {},
  actions,
  busy = false,
  onInspect,
}: {
  prompts: RetrievalPromptV3[]
  /** id → label for linked concept candidates, for the linked-concept chips. */
  conceptLabels?: Record<string, string>
  actions: RetrievalPromptActions
  busy?: boolean
  /** Optional: open a source inspector for the expected-answer blocks. */
  onInspect?: (prompt: RetrievalPromptV3) => void
}) {
  if (prompts.length === 0) {
    return (
      <section
        className='tf-review tf-review--prompts'
        aria-label='Retrieval prompts'
      >
        <h3 className='tf-aux-h'>Retrieval prompts</h3>
        <p className='tf-review-empty block-sub'>
          No retrieval prompts yet. Generated prompts will appear here for you
          to answer, save, or dismiss.
        </p>
      </section>
    )
  }

  const groups = groupPromptsByType(prompts)

  return (
    <section
      className='tf-review tf-review--prompts'
      aria-label='Retrieval prompts'
    >
      <h3 className='tf-aux-h'>Retrieval prompts</h3>
      <p className='tf-review-note block-sub'>
        Answer a prompt in your own words to make it a review card. Saving keeps
        it as a suggestion — it is not scheduled until you’ve answered it.
      </p>
      {groups.map((group) => (
        <div key={group.type} className='tf-review-group'>
          <h4 className='tf-review-group-h tf-prompt-type'>
            {RETRIEVAL_TYPE_LABEL[group.type]}
          </h4>
          <ul className='tf-review-list'>
            {group.prompts.map((p) => (
              <PromptCard
                key={p.id}
                prompt={p}
                conceptLabels={conceptLabels}
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

function PromptCard({
  prompt: p,
  conceptLabels,
  actions,
  busy,
  onInspect,
}: {
  prompt: RetrievalPromptV3
  conceptLabels: Record<string, string>
  actions: RetrievalPromptActions
  busy: boolean
  onInspect?: (prompt: RetrievalPromptV3) => void
}) {
  const [answering, setAnswering] = useState(false)
  const [answer, setAnswer] = useState(p.userAnswer ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(p.prompt)

  const chip = STATUS_CHIP[p.status]
  const schedulable = promptAllowsScheduling(p)

  return (
    <li
      className={`tf-review-card${p.status === 'rejected' ? ' is-dismissed' : ''}`}
    >
      <div className='tf-review-card-top'>
        {editing ? (
          <textarea
            className='tf-review-edit-textarea'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label='Prompt text'
            rows={2}
          />
        ) : (
          <span className='tf-review-card-prompt'>{p.prompt}</span>
        )}
        <span className={`chip ${chip.className}`}>{chip.label}</span>
      </div>

      {p.linkedConceptIds.length > 0 && (
        <div className='tf-review-linked'>
          <span className='tf-review-linked-label'>Linked concepts:</span>
          {p.linkedConceptIds.map((id) => (
            <span key={id} className='chip chip-quiet tf-review-linked-chip'>
              {conceptLabels[id] ?? id}
            </span>
          ))}
        </div>
      )}

      {schedulable && (
        <p className='tf-review-ready notice notice-ok'>
          Answered in your own words — ready to keep as a review card.
        </p>
      )}

      {answering && (
        <div className='tf-review-answer'>
          <textarea
            className='tf-review-edit-textarea'
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            aria-label='Your answer'
            rows={3}
            placeholder='Answer in your own words…'
          />
          <div className='tf-review-actions'>
            <button
              type='button'
              className='btn-ghost-xs'
              disabled={busy || answer.trim().length === 0}
              onClick={() => {
                actions.onAnswer(p.id, answer.trim())
                setAnswering(false)
              }}
            >
              Submit answer
            </button>
            <button
              type='button'
              className='btn-ghost-xs'
              disabled={busy}
              onClick={() => {
                setAnswer(p.userAnswer ?? '')
                setAnswering(false)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className='tf-review-card-foot'>
        <button
          type='button'
          className='tf-ref-btn'
          disabled={!onInspect}
          onClick={() => onInspect?.(p)}
        >
          expected answer ({p.expectedAnswerBlockIds.length} source block
          {p.expectedAnswerBlockIds.length === 1 ? '' : 's'})
        </button>
        <div className='tf-review-actions'>
          {editing ? (
            <>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || draft.trim().length === 0}
                onClick={() => {
                  actions.onEdit(p.id, draft.trim())
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
                  setDraft(p.prompt)
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || answering}
                onClick={() => setAnswering(true)}
              >
                Answer now
              </button>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || p.status === 'saved'}
                onClick={() => actions.onSave(p.id)}
              >
                Save as suggested
              </button>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy || p.status === 'rejected'}
                onClick={() => actions.onReject(p.id)}
              >
                Reject
              </button>
              <button
                type='button'
                className='btn-ghost-xs'
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
