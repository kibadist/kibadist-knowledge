'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { ApiError, api, type InboxItem } from '@/lib/api'

type Mode = 'text' | 'url' | 'pdf'

const MODES: { key: Mode; label: string }[] = [
  { key: 'text', label: 'Paste' },
  { key: 'url', label: 'Link' },
  { key: 'pdf', label: 'PDF' },
]

/**
 * The single "Add a source" card (DET-300) — the ONE place in the app that
 * accepts paste / link / PDF. It was the Transformer's capture card (the richer
 * artifact); it now drives the unified capture: each submit creates BOTH an inbox
 * triage item AND a companion TransformerSource whose article pipeline fires
 * immediately (server-side, atomically linked). The track-routing picker (DET-240)
 * lives here so a capture can be routed into a track in the same step.
 *
 * On success we invalidate the inbox + sources caches and stay put — the new row
 * appears in the inbox triage below, where it routes to Read (the article) or
 * Process (the promote gate).
 */
export function CaptureCard() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // Track-first onboarding (DET-240): the track this capture is routed into.
  const [trackId, setTrackId] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    setTitle('')
    setUrl('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const capture = useMutation<InboxItem>({
    mutationFn: async () => {
      const track = trackId || undefined
      if (mode === 'text')
        return api.captureText({
          text,
          title: title.trim() || undefined,
          trackId: track,
        })
      if (mode === 'url') return api.captureUrl({ url, trackId: track })
      if (!file) throw new Error('Choose a PDF to add')
      return api.capturePdf(file, track)
    },
    onSuccess: () => {
      resetInputs()
      // The new capture lands in the inbox triage; its companion source's article
      // pipeline is now running, so refresh both surfaces.
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
      queryClient.invalidateQueries({ queryKey: ['transformer-sources'] })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (mode === 'text' && !text.trim()) return
    if (mode === 'url' && !url.trim()) return
    if (mode === 'pdf' && !file) return
    capture.mutate()
  }

  const errorMessage =
    capture.error instanceof ApiError
      ? capture.error.message
      : capture.error instanceof Error
        ? capture.error.message
        : 'Could not add this source.'

  return (
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
        <>
          <input
            type='text'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='Title (optional)'
            className='fld'
            style={{ marginTop: 14 }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Paste an article, essay, transcript, or notes…'
            rows={8}
            className='fld'
            style={{ marginTop: 10 }}
          />
        </>
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
            id='add-source-pdf-input'
          />
          <label htmlFor='add-source-pdf-input' style={{ cursor: 'pointer' }}>
            {file ? file.name : 'Drop a PDF, or '}
            {!file && <span className='u'>choose a file</span>}
          </label>
        </div>
      )}

      {/* Track-first onboarding (DET-240): optionally route this capture into a
          track. When the earned concept is promoted, it auto-enrolls there as an
          AI candidate with suggested domains. */}
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
          {errorMessage}
        </p>
      )}

      <button
        type='submit'
        disabled={capture.isPending}
        className='btn-primary'
        style={{ marginTop: 18 }}
      >
        {capture.isPending ? 'Adding…' : 'Add a source'}{' '}
        <span className='ar'>→</span>
      </button>
    </form>
  )
}
