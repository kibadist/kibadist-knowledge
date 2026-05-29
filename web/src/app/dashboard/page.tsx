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
      <main className='flex min-h-screen items-center justify-center'>
        <p className='text-neutral-400'>Loading…</p>
      </main>
    )
  }

  return (
    <main className='mx-auto max-w-2xl p-6'>
      <header className='mb-8 flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-semibold'>Your notes</h1>
          <p className='text-sm text-neutral-400'>{user.email}</p>
        </div>
        <button
          type='button'
          onClick={logout}
          className='rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900'
        >
          Sign out
        </button>
      </header>

      <form
        onSubmit={onSubmit}
        className='mb-8 flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'
      >
        <input
          type='text'
          placeholder='Note title'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className='rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400'
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
          <p className='text-sm text-red-400'>
            {createNote.error instanceof Error
              ? createNote.error.message
              : 'Failed to create note'}
          </p>
        )}
        <button
          type='submit'
          disabled={createNote.isPending}
          className='self-start rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
        >
          {createNote.isPending ? 'Adding…' : 'Add note'}
        </button>
      </form>

      {notesQuery.isLoading && (
        <p className='text-neutral-400'>Loading notes…</p>
      )}
      {notesQuery.isError && (
        <p className='text-red-400'>Could not load notes.</p>
      )}
      {notesQuery.data?.length === 0 && (
        <p className='text-neutral-400'>No notes yet. Add your first one.</p>
      )}

      <ul className='flex flex-col gap-3'>
        {notesQuery.data?.map((note) => (
          <li
            key={note.id}
            className='rounded-lg border border-neutral-800 p-4'
          >
            <h2 className='font-medium'>{note.title}</h2>
            {note.body && (
              <div className='mt-1 text-sm text-neutral-300'>
                <RichTextViewer value={note.body} />
              </div>
            )}
            <time className='mt-2 block text-xs text-neutral-500'>
              {new Date(note.createdAt).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
    </main>
  )
}
