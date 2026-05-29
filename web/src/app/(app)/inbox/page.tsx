'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useRef, useState } from 'react'

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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const inboxQuery = useQuery({ queryKey: ['inbox'], queryFn: api.listInbox })

  function resetInputs() {
    setText('')
    setUrl('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const capture = useMutation({
    mutationFn: async () => {
      if (mode === 'text') return api.captureText({ text })
      if (mode === 'url') return api.captureUrl({ url })
      if (!file) throw new Error('Choose a PDF to capture')
      return api.capturePdf(file)
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
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Inbox</h1>
        <p className='text-sm text-neutral-400'>
          A waiting room, not a library. Capture quickly — nothing here is
          knowledge yet. You’ll earn it into a concept later.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'
      >
        <div className='flex gap-1'>
          {MODES.map((m) => (
            <button
              key={m.key}
              type='button'
              onClick={() => setMode(m.key)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                mode === m.key
                  ? 'bg-neutral-100 text-black'
                  : 'border border-neutral-700 text-neutral-300 hover:bg-neutral-900'
              }`}
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
            rows={5}
            className='resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400'
          />
        )}

        {mode === 'url' && (
          <input
            type='url'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder='https://example.com/article'
            className='rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400'
          />
        )}

        {mode === 'pdf' && (
          <input
            ref={fileInputRef}
            type='file'
            accept='application/pdf'
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className='rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 outline-none file:mr-3 file:rounded file:border-0 file:bg-neutral-700 file:px-3 file:py-1 file:text-neutral-100'
          />
        )}

        {capture.isError && (
          <p className='text-sm text-red-400'>
            {capture.error instanceof Error
              ? capture.error.message
              : 'Capture failed'}
          </p>
        )}

        <button
          type='submit'
          disabled={capture.isPending}
          className='self-start rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
        >
          {capture.isPending ? 'Capturing…' : 'Capture'}
        </button>
      </form>

      {inboxQuery.isLoading && (
        <p className='text-neutral-400'>Loading inbox…</p>
      )}
      {inboxQuery.isError && (
        <p className='text-red-400'>Could not load your inbox.</p>
      )}

      {!inboxQuery.isLoading && items.length === 0 && (
        <section className='rounded-lg border border-dashed border-neutral-800 p-8 text-center'>
          <p className='text-neutral-400'>Your inbox is empty.</p>
          <p className='mt-1 text-sm text-neutral-500'>
            Captured items wait here until you compress them into concepts.
          </p>
        </section>
      )}

      {items.length > 0 && (
        <ul className='flex flex-col gap-3'>
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
    // Deliberately distinct from earned concepts: dashed amber border + muted
    // wash signal "unprocessed / not knowledge yet".
    <li className='rounded-lg border border-dashed border-amber-700/50 bg-amber-950/10 p-4'>
      <div className='flex items-center gap-2'>
        <span className='rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90'>
          Unprocessed
        </span>
        {item.captureSource && (
          <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400'>
            {SOURCE_LABEL[item.captureSource]}
          </span>
        )}
        <button
          type='button'
          onClick={onDiscard}
          disabled={discarding}
          className='ml-auto text-xs text-neutral-500 transition hover:text-red-400 disabled:opacity-50'
        >
          {discarding ? 'Discarding…' : 'Discard'}
        </button>
      </div>

      <h2 className='mt-2 font-medium text-neutral-100'>{item.title}</h2>

      {item.sourceUrl && (
        <a
          href={item.sourceUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='mt-0.5 block truncate text-xs text-amber-400/80 hover:underline'
        >
          {item.sourceUrl}
        </a>
      )}

      {item.excerpt && (
        <p className='mt-1 line-clamp-3 text-sm text-neutral-400'>
          {item.excerpt}
        </p>
      )}

      <time className='mt-2 block text-xs text-neutral-600'>
        Captured {new Date(item.createdAt).toLocaleString()}
      </time>
    </li>
  )
}
