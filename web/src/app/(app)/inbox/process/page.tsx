'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { api } from '@/lib/api'
import {
  defaultSnoozeUntil,
  lengthLabel,
  snoozeOptions,
  sourceMark,
} from '@/lib/inbox-format'

/**
 * Focus mode — the "processing session" (DET-241). Instead of scrolling the whole
 * queue, you face one captured fragment at a time with a remaining count, and
 * decide: open it to process, skip it, or discard it. Borrowed from one-at-a-time
 * triage surfaces (email "rapid actions", review sessions) rather than the
 * read-later list everyone else ships. Still no knowledge here — "Process" hands
 * off to the interrogation flow; this screen only triages.
 */
export default function ProcessSessionPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const inboxQuery = useQuery({ queryKey: ['inbox'], queryFn: api.listInbox })
  const items = inboxQuery.data ?? []
  const [pos, setPos] = useState(0)

  const discard = useMutation({
    mutationFn: (id: string) => api.discardInboxItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  })

  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: string; until: string }) =>
      api.snoozeInboxItem(id, until),
    onSuccess: () => {
      setSnoozeOpen(false)
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
    },
  })

  // Keep the cursor in range as the queue shrinks (discarding the current item
  // slides the next one into the same slot, so staying put advances naturally).
  useEffect(() => {
    if (items.length > 0 && pos > items.length - 1) setPos(items.length - 1)
  }, [items.length, pos])

  const current = items[pos]

  // Wrapping navigation so a session can loop back over skipped fragments.
  const next = () => items.length && setPos((p) => (p + 1) % items.length)
  const prev = () =>
    items.length && setPos((p) => (p - 1 + items.length) % items.length)
  const process = () => current && router.push(`/inbox/${current.id}`)
  const drop = () => current && discard.mutate(current.id)
  const snoozeWith = (until: string) =>
    current && snooze.mutate({ id: current.id, until })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') {
        if (snoozeOpen) return setSnoozeOpen(false)
        return router.push('/inbox')
      }
      if (!items.length) return
      if (e.key === 'ArrowRight' || e.key === 'j' || e.key === ' ') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault()
        prev()
      } else if (e.key === 'Enter' || e.key === 'p') {
        process()
      } else if (e.key === 'e' || e.key === 'Backspace') {
        e.preventDefault()
        drop()
      } else if (e.key === 's') {
        e.preventDefault()
        snoozeWith(defaultSnoozeUntil())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, pos, snoozeOpen])

  if (inboxQuery.isLoading) {
    return (
      <div className='screen'>
        <p className='notice'>Loading session…</p>
      </div>
    )
  }

  // Inbox zero — the end state a list never gives you.
  if (items.length === 0) {
    return (
      <div className='screen'>
        <div className='page-head'>
          <div className='section-label'>§ Capture · Session</div>
          <h1>All clear</h1>
          <p className='lede'>
            Nothing left to process. The waiting room is empty — every fragment
            has been earned into a concept or let go.
          </p>
        </div>
        <div className='session-done'>
          <span className='session-done-mark'>○</span>
          <Link href='/inbox' className='btn-primary'>
            Back to inbox <span className='ar'>→</span>
          </Link>
        </div>
      </div>
    )
  }

  const mark = sourceMark(current)
  const length = lengthLabel(current.wordCount)

  return (
    <div className='screen'>
      <div className='session-top'>
        <Link href='/inbox' className='back-link'>
          ← Inbox
        </Link>
        <span className='session-progress'>
          {pos + 1} <span>/ {items.length}</span>
        </span>
      </div>

      <article className='session-card panel panel-raised'>
        <div className='session-meta'>
          <span className='row-source'>
            <span className={`src-dot${current.sourceUrl ? ' is-link' : ''}`} />
            {mark}
          </span>
          {length && <span className='row-len'>{length}</span>}
          <span className='row-when'>
            {new Date(current.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>

        <h1 className='session-title'>{current.title}</h1>

        {current.sourceUrl && (
          <a
            href={current.sourceUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='row-url'
          >
            {current.sourceUrl}
          </a>
        )}

        {current.excerpt && (
          <p className='session-excerpt'>{current.excerpt}</p>
        )}
      </article>

      <div className='session-actions'>
        <button type='button' onClick={prev} className='session-btn'>
          ← Prev
        </button>
        <button type='button' onClick={next} className='session-btn'>
          Skip
        </button>
        <button
          type='button'
          onClick={drop}
          disabled={discard.isPending}
          className='session-btn session-btn-danger'
        >
          {discard.isPending ? 'Discarding…' : 'Discard'}
        </button>
        <div className='session-snooze'>
          <button
            type='button'
            onClick={() => setSnoozeOpen((o) => !o)}
            disabled={snooze.isPending}
            aria-expanded={snoozeOpen}
            className='session-btn'
          >
            {snooze.isPending ? 'Snoozing…' : 'Snooze ▾'}
          </button>
          {snoozeOpen && (
            <div className='snooze-menu'>
              {snoozeOptions().map((o) => (
                <button
                  key={o.key}
                  type='button'
                  onClick={() => snoozeWith(o.until)}
                  className='snooze-opt'
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type='button'
          onClick={process}
          className='session-btn session-btn-primary'
        >
          Process <span className='ar'>→</span>
        </button>
      </div>

      <p className='session-hint'>
        <kbd>←</kbd>
        <kbd>→</kbd> move · <kbd>↵</kbd> process · <kbd>S</kbd> snooze ·{' '}
        <kbd>E</kbd> discard · <kbd>Esc</kbd> exit
      </p>
    </div>
  )
}
