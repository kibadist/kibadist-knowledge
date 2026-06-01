'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'

import { RichTextEditor, RichTextViewer } from '@/components/editor'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'

export default function DashboardPage() {
  const { user, loading, logout } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [bodyEmpty, setBodyEmpty] = useState(true)
  const [editorKey, setEditorKey] = useState(0)

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  const notesQuery = useQuery({
    queryKey: ['notes'],
    queryFn: api.listNotes,
    enabled: !!user,
  })

  const createNote = useMutation({
    mutationFn: () =>
      api.createNote({ title, body: bodyEmpty ? undefined : body }),
    onSuccess: () => {
      setTitle('')
      setBody('')
      setBodyEmpty(true)
      setEditorKey((key) => key + 1)
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    createNote.mutate()
  }

  if (loading || !user) {
    return (
      <div className='kbapp'>
        <main className='page' style={{ paddingTop: '6rem' }}>
          <p className='text-ink-muted'>Loading…</p>
        </main>
      </div>
    )
  }

  return (
    <div className='kbapp'>
      <main className='page screen'>
        <header
          className='page-head'
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <span className='section-label'>§ Notebook</span>
            <h1>Your notes</h1>
            <p className='block-sub u-mono'>{user.email}</p>
          </div>
          <button
            type='button'
            onClick={logout}
            className='btn-ghost-xs'
            style={{ marginTop: '0.25rem', flexShrink: 0 }}
          >
            Sign out
          </button>
        </header>

        <div className='panel panel-raised'>
          <form
            onSubmit={onSubmit}
            className='flex flex-col'
            style={{ gap: '0.75rem' }}
          >
            <input
              type='text'
              placeholder='Note title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className='fld'
            />
            <RichTextEditor
              key={editorKey}
              placeholder='Write something…'
              onChange={(serializedState, isEmpty) => {
                setBody(serializedState)
                setBodyEmpty(isEmpty)
              }}
            />
            {createNote.isError && (
              <div className='notice notice-error'>
                {createNote.error instanceof Error
                  ? createNote.error.message
                  : 'Failed to create note'}
              </div>
            )}
            <button
              type='submit'
              disabled={createNote.isPending}
              className='btn-primary'
              style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
            >
              {createNote.isPending ? 'Adding…' : 'Add note'}{' '}
              <span className='ar'>→</span>
            </button>
          </form>
        </div>

        {notesQuery.isLoading && <div className='notice'>Loading notes…</div>}
        {notesQuery.isError && (
          <div className='notice notice-error'>Could not load notes.</div>
        )}
        {notesQuery.data?.length === 0 && (
          <div className='empty'>
            <span>No notes yet. Add your first one above.</span>
          </div>
        )}

        <ul
          className='rows'
          style={{ listStyle: 'none', padding: 0, margin: 0 }}
        >
          {notesQuery.data?.map((note) => (
            <li key={note.id} className='item-card'>
              <h2 className='block-h'>{note.title}</h2>
              {note.body && (
                <div className='u-body' style={{ marginTop: '0.25rem' }}>
                  <RichTextViewer value={note.body} />
                </div>
              )}
              <time
                className='u-mono text-ink-muted'
                style={{
                  display: 'block',
                  marginTop: '0.5rem',
                  fontSize: '0.75rem',
                }}
              >
                {new Date(note.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
