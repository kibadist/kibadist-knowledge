'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { api, type InboxItem } from '@/lib/api'
import {
  defaultSnoozeUntil,
  domainOf,
  isToday,
  lengthLabel,
  sourceMark,
} from '@/lib/inbox-format'

type Mode = 'text' | 'url' | 'pdf'

const MODES: { key: Mode; label: string }[] = [
  { key: 'text', label: 'Paste' },
  { key: 'url', label: 'Link' },
  { key: 'pdf', label: 'PDF' },
]

/**
 * Inbox — the low-friction capture surface (step 1 of the core loop). Captured
 * items are a deliberate holding area, NOT knowledge: no graph links, no
 * retrieval, no AI summary. They're earned into concepts later. The UI leans
 * into "a waiting room, not a library" (DET-187).
 *
 * Triage affordances (DET-241): rather than tagging every row "Unprocessed"
 * (redundant — the whole screen is the unprocessed queue), each row carries a
 * source + read-time signal, the queue shows its count and groups by day, and
 * Process is the primary action. Keyboard: j/k to move, P to process, E to
 * discard — clearing the inbox is meant to feel like a finishable pass.
 */
export default function InboxPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // Track-first onboarding (DET-240): the track this capture is routed into.
  const [trackId, setTrackId] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const inboxQuery = useQuery({ queryKey: ['inbox'], queryFn: api.listInbox })
  // Active tracks to route a capture into (DET-240). Reading the list client-side
  // keeps the picker in sync with whatever world is active.
  const tracksQuery = useQuery({
    queryKey: ['tracks'],
    queryFn: () => api.listTracks('ACTIVE'),
  })

  // Preselect a track when arriving from a track's "import a source" link
  // (/inbox?track=<id>). Read from the URL on mount to avoid a Suspense boundary.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('track')
    if (param) setTrackId(param)
  }, [])

  function resetInputs() {
    setText('')
    setUrl('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const capture = useMutation({
    mutationFn: async () => {
      const track = trackId || undefined
      if (mode === 'text') return api.captureText({ text, trackId: track })
      if (mode === 'url') return api.captureUrl({ url, trackId: track })
      if (!file) throw new Error('Choose a PDF to capture')
      return api.capturePdf(file, track)
    },
    onSuccess: () => {
      resetInputs()
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
    },
  })

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
      router.push(`/inbox/${merged.id}`)
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

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'text' && !text.trim()) return
    if (mode === 'url' && !url.trim()) return
    if (mode === 'pdf' && !file) return
    capture.mutate()
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
        const item = items[focused]
        if (item) router.push(`/inbox/${item.id}`)
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
        <h1>Inbox</h1>
        {items.length > 0 && (
          <div className='head-count'>{items.length} waiting</div>
        )}
        <p className='lede'>
          A waiting room, not a library. Capture quickly — nothing here is
          knowledge yet. You’ll earn it into a concept later.
        </p>
      </div>

      <form onSubmit={onSubmit} className='panel panel-raised capture'>
        <div className='seg-row'>
          {MODES.map((m) => (
            <button
              key={m.key}
              type='button'
              onClick={() => setMode(m.key)}
              className={`seg${mode === m.key ? ' on' : ''}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === 'text' && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Paste a quote, transcript, or idea fragment…'
            rows={4}
            className='fld'
            style={{ marginTop: 14 }}
          />
        )}

        {mode === 'url' && (
          <input
            type='url'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder='https://example.com/article'
            className='fld'
            style={{ marginTop: 14 }}
          />
        )}

        {mode === 'pdf' && (
          <div className='file-drop' style={{ marginTop: 14 }}>
            <input
              ref={fileInputRef}
              type='file'
              accept='application/pdf'
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
              id='pdf-input'
            />
            <label htmlFor='pdf-input' style={{ cursor: 'pointer' }}>
              {file ? file.name : 'Drop a PDF, or '}
              {!file && <span className='u'>choose a file</span>}
            </label>
          </div>
        )}

        {/* Track-first onboarding (DET-240): optionally route this capture into a
            track. When the earned concept is promoted, it auto-enrolls there as
            an AI candidate with suggested domains. */}
        {(tracksQuery.data?.length ?? 0) > 0 && (
          <label className='capture-track' style={{ marginTop: 14 }}>
            <span className='capture-track-label'>Add to track (optional)</span>
            <select
              className='fld'
              value={trackId}
              onChange={(e) => setTrackId(e.target.value)}
            >
              <option value=''>No track — just capture</option>
              {tracksQuery.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {capture.isError && (
          <p className='notice notice-error' style={{ marginTop: 14 }}>
            {capture.error instanceof Error
              ? capture.error.message
              : 'Capture failed'}
          </p>
        )}

        <button
          type='submit'
          disabled={capture.isPending}
          className='btn-primary'
          style={{ marginTop: 18 }}
        >
          {capture.isPending ? 'Capturing…' : 'Capture'}{' '}
          <span className='ar'>→</span>
        </button>
      </form>

      {inboxQuery.isLoading && <p className='notice'>Loading inbox…</p>}
      {inboxQuery.isError && (
        <p className='notice notice-error'>Could not load your inbox.</p>
      )}

      {!inboxQuery.isLoading && items.length === 0 && (
        <div className='empty'>
          Your inbox is empty.
          <span>
            Captured items wait here until you compress them into concepts.
          </span>
        </div>
      )}

      {items.length > 0 && (
        <div className='queue'>
          {selected.size > 0 ? (
            <div className='forge-bar'>
              <span className='forge-count'>
                {selected.size} selected
                {selected.size < 2 && ' — pick one more to forge'}
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
                    ? 'Forging…'
                    : `Forge ${selected.size} into one`}{' '}
                  <span className='ar'>→</span>
                </button>
              </div>
            </div>
          ) : (
            <div className='queue-bar'>
              <Link href='/inbox/process' className='process-all'>
                Process today’s batch <span className='ar'>→</span>
              </Link>
              <span className='queue-hint'>
                <kbd>J</kbd>
                <kbd>K</kbd> move · <kbd>P</kbd> process · <kbd>S</kbd> snooze ·{' '}
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
          aria-label={selected ? 'Deselect for forge' : 'Select for forge'}
          className={`row-select${selected ? ' is-on' : ''}`}
        >
          {selected ? '✓' : ''}
        </button>
        <span className='row-source'>
          <span className={`src-dot${domain ? ' is-link' : ''}`} />
          {mark}
        </span>
        {length && <span className='row-len'>{length}</span>}
        <time className='row-when'>
          {new Date(item.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </time>
        <button
          type='button'
          onClick={onDiscard}
          disabled={discarding}
          className='row-discard'
        >
          {discarding ? 'Discarding…' : 'Discard'}
        </button>
      </div>

      <Link href={`/inbox/${item.id}`} className='row-title'>
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
        <Link href={`/inbox/${item.id}`} className='row-process'>
          Process <span className='ar'>→</span>
        </Link>
      </div>
    </li>
  )
}
