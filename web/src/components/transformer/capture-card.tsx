'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type FormEvent, useRef, useState } from 'react'

import { ApiError, api, type TransformerSourceListItem } from '@/lib/api'

type Mode = 'text' | 'url' | 'pdf'

const MODES: { key: Mode; label: string }[] = [
  { key: 'text', label: 'Paste text' },
  { key: 'url', label: 'URL' },
  { key: 'pdf', label: 'PDF' },
]

/**
 * The transformer capture card: three tabs (paste text w/ optional title, a URL,
 * or a PDF upload) that each ingest a source and fire the pipeline. On success we
 * invalidate the sources list and navigate straight into the new source's
 * pipeline view so the user watches it extract.
 */
export function CaptureCard() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function resetInputs() {
    setText('')
    setTitle('')
    setUrl('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const capture = useMutation<TransformerSourceListItem>({
    mutationFn: async () => {
      if (mode === 'text')
        return api.createTextSource({
          text,
          title: title.trim() || undefined,
        })
      if (mode === 'url') return api.createUrlSource({ url })
      if (!file) throw new Error('Choose a PDF to transform')
      return api.createPdfSource(file)
    },
    onSuccess: (source) => {
      resetInputs()
      queryClient.invalidateQueries({ queryKey: ['transformer-sources'] })
      router.push(`/transformer/${source.id}`)
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
        : 'Could not ingest this source.'

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
            placeholder='Paste an article, essay, transcript, or notes to reshape…'
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
            id='transformer-pdf-input'
          />
          <label htmlFor='transformer-pdf-input' style={{ cursor: 'pointer' }}>
            {file ? file.name : 'Drop a PDF, or '}
            {!file && <span className='u'>choose a file</span>}
          </label>
        </div>
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
        {capture.isPending ? 'Ingesting…' : 'Transform'}{' '}
        <span className='ar'>→</span>
      </button>
    </form>
  )
}
