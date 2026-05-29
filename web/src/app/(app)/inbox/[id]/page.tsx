'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { api, type IntakeQuestion } from '@/lib/api'

const KIND_LABEL: Record<string, string> = {
  central_claim: 'Central claim',
  terminology: 'Terminology',
  assumption: 'Assumption',
  ambiguity: 'Ambiguity',
  sharpen: 'Sharpen',
  connection: 'Connection',
}

/**
 * Process an inbox item (DET-188). The AI interrogates — it asks 3-5 questions
 * to make the user think. The user answers in their OWN words; the AI never
 * drafts or pre-fills. This screen only captures answers; promoting the item
 * into a permanent concept is a later step.
 */
export default function ProcessInboxItemPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const queryClient = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const itemQuery = useQuery({
    queryKey: ['inbox-item', id],
    queryFn: () => api.getInboxItem(id),
  })

  // POST is idempotent (generate-or-load), so it's safe as a query fn.
  const questionsQuery = useQuery({
    queryKey: ['interrogation', id],
    queryFn: () => api.generateInterrogation(id),
  })

  // Seed the answer fields once questions load (preserving any saved answers).
  useEffect(() => {
    if (questionsQuery.data) {
      setAnswers((prev) => {
        const seeded: Record<string, string> = {}
        for (const q of questionsQuery.data) {
          seeded[q.id] = prev[q.id] ?? q.answer ?? ''
        }
        return seeded
      })
    }
  }, [questionsQuery.data])

  const save = useMutation({
    mutationFn: (questions: IntakeQuestion[]) =>
      api.saveInterrogationAnswers(
        id,
        questions.map((q) => ({
          questionId: q.id,
          answer: answers[q.id] ?? '',
        })),
      ),
    onSuccess: (data) => {
      setSaved(true)
      queryClient.setQueryData(['interrogation', id], data)
    },
  })

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Link
          href='/inbox'
          className='text-sm text-neutral-400 hover:underline'
        >
          ← Back to inbox
        </Link>
        <h1 className='mt-2 text-2xl font-semibold'>
          {itemQuery.data?.title ?? 'Processing…'}
        </h1>
        <p className='text-sm text-neutral-400'>
          Answer in your own words. We ask the questions — we won’t write your
          understanding for you.
        </p>
      </div>

      {itemQuery.data?.sourceText && (
        <section className='max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-400'>
          {itemQuery.data.sourceText}
        </section>
      )}

      {questionsQuery.isLoading && (
        <p className='text-neutral-400'>
          Reading it and thinking up questions…
        </p>
      )}
      {questionsQuery.isError && (
        <div className='rounded-lg border border-amber-700/50 bg-amber-950/10 p-4'>
          <p className='text-sm text-amber-300/90'>
            {questionsQuery.error instanceof Error
              ? questionsQuery.error.message
              : 'Could not generate questions.'}
          </p>
          <button
            type='button'
            onClick={() => questionsQuery.refetch()}
            className='mt-2 rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900'
          >
            Try again
          </button>
        </div>
      )}

      {questionsQuery.data && questionsQuery.data.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSaved(false)
            save.mutate(questionsQuery.data)
          }}
          className='flex flex-col gap-5'
        >
          <ol className='flex flex-col gap-5'>
            {questionsQuery.data.map((q, i) => (
              <li key={q.id} className='flex flex-col gap-2'>
                <div className='flex items-baseline gap-2'>
                  <span className='text-sm font-medium text-neutral-500'>
                    {i + 1}.
                  </span>
                  {q.kind && KIND_LABEL[q.kind] && (
                    <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
                      {KIND_LABEL[q.kind]}
                    </span>
                  )}
                </div>
                <p className='font-medium text-neutral-100'>{q.prompt}</p>
                <textarea
                  value={answers[q.id] ?? ''}
                  onChange={(e) => {
                    setSaved(false)
                    setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }}
                  placeholder='Your answer, in your own words…'
                  rows={3}
                  className='resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400'
                />
              </li>
            ))}
          </ol>

          {save.isError && (
            <p className='text-sm text-red-400'>
              {save.error instanceof Error
                ? save.error.message
                : 'Failed to save answers'}
            </p>
          )}

          <div className='flex items-center gap-3'>
            <button
              type='submit'
              disabled={save.isPending}
              className='self-start rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
            >
              {save.isPending ? 'Saving…' : 'Save my answers'}
            </button>
            {saved && !save.isPending && (
              <span className='text-sm text-green-400'>Saved.</span>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
