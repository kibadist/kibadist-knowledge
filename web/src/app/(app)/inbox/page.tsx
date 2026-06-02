'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { api, type CaptureSource, type InboxItem } from '@/lib/api'

type Mode = 'text' | 'url' | 'pdf'

const MODES: { key: Mode; label: string }[] = [
  { key: 'text', label: 'Paste' },
  { key: 'url', label: 'Link' },
  { key: 'pdf', label: 'PDF' },
]

const SOURCE_LABEL: Record<CaptureSource, string> = {
  PASTE: 'Paste',
  URL: 'Link',
  PDF: 'PDF',
}

/**
 * Inbox — the low-friction capture surface (step 1 of the core loop). Captured
 * items are a deliberate holding area, NOT knowledge: no graph links, no
 * retrieval, no AI summary. They're earned into concepts later. The UI leans
 * into "a waiting room, not a library" (DET-187).
 */
export default function InboxPage() {
  const queryClient = useQueryClient()
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

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'text' && !text.trim()) return
    if (mode === 'url' && !url.trim()) return
    if (mode === 'pdf' && !file) return
    capture.mutate()
  }

  const items = inboxQuery.data ?? []

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Capture · Step 01</div>
        <h1>Inbox</h1>
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
        <ul className='rows'>
          {items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              onDiscard={() => discard.mutate(item.id)}
              discarding={discard.isPending && discard.variables === item.id}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function InboxRow({
  item,
  onDiscard,
  discarding,
}: {
  item: InboxItem
  onDiscard: () => void
  discarding: boolean
}) {
  return (
    // Deliberately distinct from earned concepts: the ochre "Unprocessed" chip
    // signals "not knowledge yet".
    <li className='inbox-row'>
      <div className='row-top'>
        <span className='chip chip-pending'>Unprocessed</span>
        {item.captureSource && (
          <span className='chip chip-quiet'>
            {SOURCE_LABEL[item.captureSource]}
          </span>
        )}
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
        <time>Captured {new Date(item.createdAt).toLocaleString()}</time>
        <Link href={`/inbox/${item.id}`} className='row-process'>
          Process →
        </Link>
      </div>
    </li>
  )
}
