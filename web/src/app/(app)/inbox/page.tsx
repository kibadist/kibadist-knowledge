'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { EmptyState } from '@/components/empty-state'
import { InboxProgressGlyph } from '@/components/inbox/progress-glyph'
import { CaptureCard } from '@/components/transformer/capture-card'
import { api, type InboxItem } from '@/lib/api'
import {
  defaultSnoozeUntil,
  domainOf,
  isToday,
  lengthLabel,
  sourceMark,
} from '@/lib/inbox-format'

/**
 * Inbox — the single capture + triage surface (DET-300). The one "Add a source"
 * card (paste / link / PDF) lives at the top; below it is the triage queue of
 * unprocessed captures. Each capture also ingests a companion TransformerSource
 * (the richer artifact) server-side, so a row can route to BOTH the reading
 * surface (the generated article) and the promote gate (Process) from the same
 * place — the two front-door pipelines no longer compete.
 *
 * Captured items are a deliberate holding area, NOT knowledge: no graph links, no
 * retrieval, no AI summary. They're earned into concepts later (DET-187).
 *
 * Triage affordances (DET-241): each row carries a source + read-time signal, the
 * queue shows its count and groups by day, and Process is the primary action.
 * Keyboard: j/k to move, P to process, S snooze, X select, F forge, E discard —
 * clearing the inbox is meant to feel like a finishable pass.
 */
export default function InboxPage() {
  const queryClient = useQueryClient()
  const router = useRouter()

  const inboxQuery = useQuery({ queryKey: ['inbox'], queryFn: api.listInbox })

  const discard = useMutation({
    mutationFn: (id: string) => api.discardInboxItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  })

  // Snooze (DET-241): "S" hides the focused item until tomorrow morning. The
  // quick keyboard path uses the default; focus mode offers the full presets.
  const snooze = useMutation({
    mutationFn: (id: string) => api.snoozeInboxItem(id, defaultSnoozeUntil()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  })

  // The Forge (DET-241): select 2+ fragments and merge them into one item, then
  // land in its processing flow — promotion becomes synthesis. The originals are
  // consumed server-side (their text lives on in the merged item).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const forge = useMutation({
    mutationFn: (ids: string[]) => api.forgeInbox(ids),
    onSuccess: (merged) => {
      setSelected(new Set())
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
      router.push(`/read/${merged.id}`)
    },
  })

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const items = inboxQuery.data ?? []
  const today = items.filter((i) => isToday(i.createdAt))
  const earlier = items.filter((i) => !isToday(i.createdAt))

  // Keyboard triage (DET-241): j/k move a focus cursor through the flat queue,
  // P processes the focused item, E discards it. Disabled while typing into the
  // capture box so the textarea keeps its own keys.
  const [focused, setFocused] = useState(0)
  const rowRefs = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    if (focused > items.length - 1) setFocused(Math.max(0, items.length - 1))
  }, [items.length, focused])

  // Drop selections whose items are gone (forged, discarded, or snoozed away).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const present = new Set(items.map((i) => i.id))
      const next = new Set([...prev].filter((id) => present.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  // Selected ids in list order — the order they merge into the forged item.
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!items.length) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocused((f) => Math.min(items.length - 1, f + 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocused((f) => Math.max(0, f - 1))
      } else if (e.key === 'p' || e.key === 'Enter') {
        // One destination (DET-313): open the document workspace, which picks
        // Source vs Article by readiness — no separate Process step.
        const item = items[focused]
        if (item) router.push(`/read/${item.id}`)
      } else if (e.key === 'e') {
        const item = items[focused]
        if (item) discard.mutate(item.id)
      } else if (e.key === 's') {
        const item = items[focused]
        if (item) snooze.mutate(item.id)
      } else if (e.key === 'x') {
        e.preventDefault()
        const item = items[focused]
        if (item) toggleSelect(item.id)
      } else if (e.key === 'f') {
        if (selectedIds.length >= 2 && !forge.isPending)
          forge.mutate(selectedIds)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, focused, router, discard, snooze, forge, selectedIds])

  useEffect(() => {
    rowRefs.current[focused]?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  // Stable index across both day-groups so the keyboard cursor and refs line up
  // with the flat `items` order.
  function renderRow(item: InboxItem) {
    const index = items.indexOf(item)
    return (
      <InboxRow
        key={item.id}
        ref={(el) => {
          rowRefs.current[index] = el
        }}
        item={item}
        focused={index === focused}
        selected={selected.has(item.id)}
        onToggleSelect={() => toggleSelect(item.id)}
        onFocus={() => setFocused(index)}
        onDiscard={() => discard.mutate(item.id)}
        discarding={discard.isPending && discard.variables === item.id}
      />
    )
  }

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Capture · Step 01</div>
        <h1>Add a source</h1>
        {items.length > 0 && (
          <div className='head-count'>{items.length} waiting</div>
        )}
        <p className='lede'>
          One front door. Paste a quote, a link, or a PDF — it lands in the
          queue below and is reshaped into a readable article in the background.
          Nothing here is knowledge yet; you’ll earn it into a concept later.
        </p>
      </div>

      <CaptureCard />

      {inboxQuery.isLoading && <p className='notice'>Loading inbox…</p>}
      {inboxQuery.isError && (
        <p className='notice notice-error'>Could not load your inbox.</p>
      )}

      {!inboxQuery.isLoading && items.length === 0 && (
        // The first step of the loop — no step exists before capture, and the
        // "Add a source" card sits directly above, so this is an aligned
        // observation with no back-link (DET-308).
        <EmptyState
          message='Your reading queue is empty.'
          hint='Add a source above — a quote, a link, or a PDF — and it lands here to read.'
        />
      )}

      {items.length > 0 && (
        <div className='queue'>
          {selected.size > 0 ? (
            <div className='forge-bar'>
              <span className='forge-count'>
                {selected.size} selected
                {selected.size < 2 && ' — pick one more to merge'}
              </span>
              <div className='forge-actions'>
                <button
                  type='button'
                  onClick={() => setSelected(new Set())}
                  className='forge-clear'
                >
                  Clear
                </button>
                <button
                  type='button'
                  onClick={() => forge.mutate(selectedIds)}
                  disabled={selectedIds.length < 2 || forge.isPending}
                  className='forge-go'
                >
                  {forge.isPending
                    ? 'Merging…'
                    : `Merge ${selected.size} into one`}{' '}
                  <span className='ar'>→</span>
                </button>
              </div>
            </div>
          ) : (
            <div className='queue-bar'>
              {/* One vocabulary (DET-316): reading IS processing, so the row's
                  single Open → is the only forward action — no "Process" batch
                  pass competing with the read → earn → review loop. */}
              <span className='queue-hint'>
                <kbd>J</kbd>
                <kbd>K</kbd> move · <kbd>P</kbd> open · <kbd>S</kbd> snooze ·{' '}
                <kbd>X</kbd> select · <kbd>E</kbd> discard
              </span>
            </div>
          )}

          {today.length > 0 && (
            <section className='queue-group'>
              <h2 className='group-head'>
                Today <span>{today.length}</span>
              </h2>
              <ul className='rows'>{today.map(renderRow)}</ul>
            </section>
          )}

          {earlier.length > 0 && (
            <section className='queue-group'>
              <h2 className='group-head'>
                Earlier <span>{earlier.length}</span>
              </h2>
              <ul className='rows'>{earlier.map(renderRow)}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

const InboxRow = ({
  ref,
  item,
  focused,
  selected,
  onToggleSelect,
  onFocus,
  onDiscard,
  discarding,
}: {
  ref: (el: HTMLLIElement | null) => void
  item: InboxItem
  focused: boolean
  selected: boolean
  onToggleSelect: () => void
  onFocus: () => void
  onDiscard: () => void
  discarding: boolean
}) => {
  const domain = domainOf(item.sourceUrl)
  const mark = sourceMark(item)
  const length = lengthLabel(item.wordCount)
  // Two-step delete: the first click arms the confirm, since deleting removes
  // the source AND its generated article (not just an inbox stub).
  const [confirming, setConfirming] = useState(false)

  return (
    // Deliberately distinct from earned concepts. We drop the per-row
    // "Unprocessed" chip (the whole queue is unprocessed) and lead instead with
    // a source + read-time signal so the list is scannable by what each item IS.
    <li
      ref={ref}
      className={`inbox-row${focused ? ' is-focused' : ''}${
        selected ? ' is-selected' : ''
      }`}
      onMouseEnter={onFocus}
    >
      <div className='row-top'>
        <button
          type='button'
          onClick={onToggleSelect}
          aria-pressed={selected}
          aria-label={selected ? 'Deselect for merge' : 'Select for merge'}
          className={`row-select${selected ? ' is-on' : ''}`}
        >
          {selected ? '✓' : ''}
        </button>
        <span className='row-source'>
          <span className={`src-dot${domain ? ' is-link' : ''}`} />
          {mark}
        </span>
        {item.originArticleId && (
          // Validated out of a source-preserving article (DET-283): badge the
          // origin and link back to the article it was learned from.
          <Link
            href={`/transformer/articles/${item.originArticleId}`}
            className='row-from-article'
          >
            from article →
          </Link>
        )}
        {length && <span className='row-len'>{length}</span>}
        {/* Per-source progress glyph (DET-316): read → recalled → kept. */}
        <InboxProgressGlyph learning={item.learning} />
        <time className='row-when'>
          {new Date(item.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </time>
        {confirming ? (
          <span className='row-discard-confirm'>
            <button
              type='button'
              onClick={() => {
                setConfirming(false)
                onDiscard()
              }}
              disabled={discarding}
              className='row-discard is-danger'
              title='Removes this source and its generated article'
            >
              {discarding ? 'Deleting…' : 'Delete source'}
            </button>
            <button
              type='button'
              onClick={() => setConfirming(false)}
              disabled={discarding}
              className='row-discard'
              aria-label='Cancel delete'
            >
              ✕
            </button>
          </span>
        ) : (
          <button
            type='button'
            onClick={() => setConfirming(true)}
            className='row-discard'
            title='Delete this source and its generated article'
          >
            Delete
          </button>
        )}
      </div>

      <Link href={`/read/${item.id}`} className='row-title'>
        {item.title}
      </Link>

      {item.sourceUrl && (
        <a
          href={item.sourceUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='row-url'
        >
          {item.sourceUrl}
        </a>
      )}

      {item.excerpt && <p className='row-excerpt'>{item.excerpt}</p>}

      <div className='row-foot'>
        {/* One destination (DET-313): a single forward action into the document
            workspace. /read picks Source vs Article by readiness, so the row no
            longer forks into Process / Read / View source. */}
        <Link href={`/read/${item.id}`} className='row-process row-open'>
          Open <span className='ar'>→</span>
        </Link>
      </div>
    </li>
  )
}
