'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ArticleBlocks } from '@/components/reader/article-blocks'
import {
  ArticleReader,
  ReaderError,
  ReaderSkeleton,
} from '@/components/reader/article-reader'
import { api, type IntakeQuestion, type SourceQuestion } from '@/lib/api'

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
 *
 * Reference Q&A (DET-208) lives alongside: the user may ask the AI questions
 * about the source and get source-grounded SCAFFOLD answers. Scaffold is clearly
 * labeled and is never knowledge — promotion still goes through the gate.
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
        <Link
          href={`/inbox/${id}/promote`}
          className='mt-3 inline-block rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200'
        >
          Promote to a concept →
        </Link>
      </div>

      {itemQuery.isLoading && <ReaderSkeleton />}
      {itemQuery.isError && (
        <ReaderError
          message={
            itemQuery.error instanceof Error
              ? itemQuery.error.message
              : 'Could not load this source.'
          }
          onRetry={() => itemQuery.refetch()}
        />
      )}

      {itemQuery.data?.sourceText && (
        <ArticleReader
          document={itemQuery.data.sourceDocument}
          content={itemQuery.data.sourceText}
          sourceUrl={itemQuery.data.sourceUrl}
          captureSource={itemQuery.data.captureSource}
          capturedAt={itemQuery.data.createdAt}
        />
      )}

      {itemQuery.data?.sourceDocument && <ConceptLibraryPanel inboxId={id} />}

      {itemQuery.data?.sourceText && <ReferenceQaPanel conceptId={id} />}

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

/**
 * Reference Q&A (DET-208). Ask the source questions while reading; the AI answers
 * with a source-grounded scaffold. Every answer is visibly marked as scaffold —
 * a comprehension aid, NOT the user's knowledge. None of this can be promoted;
 * the user still has to articulate in their own words at the gate.
 */
function ReferenceQaPanel({ conceptId }: { conceptId: string }) {
  const queryClient = useQueryClient()
  const [question, setQuestion] = useState('')

  const historyQuery = useQuery({
    queryKey: ['source-qa', conceptId],
    queryFn: () => api.listSourceQuestions(conceptId),
  })

  const ask = useMutation({
    mutationFn: (q: string) => api.askSourceQuestion(conceptId, q),
    onSuccess: (created) => {
      queryClient.setQueryData<SourceQuestion[]>(
        ['source-qa', conceptId],
        (prev) => [...(prev ?? []), created],
      )
      setQuestion('')
    },
  })

  const remove = useMutation({
    mutationFn: (entryId: string) => api.deleteSourceQuestion(entryId),
    onSuccess: (_void, entryId) => {
      queryClient.setQueryData<SourceQuestion[]>(
        ['source-qa', conceptId],
        (prev) => (prev ?? []).filter((e) => e.id !== entryId),
      )
    },
  })

  const trimmed = question.trim()

  return (
    <section className='flex flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-950/30 p-4'>
      <div>
        <h2 className='text-sm font-semibold text-neutral-200'>
          Ask about the source
        </h2>
        <p className='text-xs text-neutral-500'>
          Answers are grounded in the text to help you read. They’re reference
          scaffold — not your knowledge. You’ll still articulate it yourself.
        </p>
      </div>

      {historyQuery.data && historyQuery.data.length > 0 && (
        <ul className='flex flex-col gap-3'>
          {historyQuery.data.map((entry) => (
            <li
              key={entry.id}
              className='rounded-md border border-neutral-800 bg-neutral-900/40 p-3'
            >
              <div className='flex items-start justify-between gap-2'>
                <p className='text-sm font-medium text-neutral-200'>
                  {entry.questionText}
                </p>
                <button
                  type='button'
                  onClick={() => remove.mutate(entry.id)}
                  className='shrink-0 text-xs text-neutral-600 transition hover:text-neutral-300'
                  aria-label='Discard this question'
                >
                  ✕
                </button>
              </div>
              {entry.answerText && (
                <div className='mt-2 border-l-2 border-amber-700/40 pl-3'>
                  <span className='inline-block rounded border border-amber-700/40 bg-amber-950/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300/80'>
                    Reference · AI scaffold
                  </span>
                  <p className='mt-1.5 whitespace-pre-wrap text-sm text-neutral-400'>
                    {entry.answerText}
                  </p>
                  {entry.citations.length > 0 && (
                    <ul className='mt-2 flex flex-col gap-1'>
                      {entry.citations.map((c, i) => (
                        <li
                          key={i}
                          className='border-l border-neutral-700 pl-2 text-xs italic text-neutral-500'
                        >
                          “{c.quote}”
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) ask.mutate(trimmed)
        }}
        className='flex flex-col gap-2'
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='e.g. What does the author mean by this term?'
          rows={2}
          className='resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400'
        />
        {ask.isError && (
          <p className='text-sm text-red-400'>
            {ask.error instanceof Error
              ? ask.error.message
              : 'Could not answer right now'}
          </p>
        )}
        <button
          type='submit'
          disabled={ask.isPending || !trimmed}
          className='self-start rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900 disabled:opacity-50'
        >
          {ask.isPending ? 'Asking…' : 'Ask the source'}
        </button>
      </form>
    </section>
  )
}

/**
 * The Concept Library (DET-211). A captured structured article bundles many
 * cognitive objects into one wall of text. Here we surface it broken into
 * section-sized learnable pieces so the article becomes something you study and
 * recall one chunk at a time, not re-read whole. Only shown for an article with
 * ≥ 2 chunks — a single-chunk article gains nothing from being "split".
 *
 * MVP scope: this SURFACES the library. Promoting an individual chunk into its
 * own concept is the natural next step (it needs schema/flow changes) and is not
 * wired yet — the note below keeps the UI honest about that.
 */
function ConceptLibraryPanel({ inboxId }: { inboxId: string }) {
  const chunksQuery = useQuery({
    queryKey: ['inbox-chunks', inboxId],
    queryFn: () => api.getInboxChunks(inboxId),
  })

  const chunks = chunksQuery.data
  // A single-chunk (or empty) article gains nothing from being split — hide it.
  if (!chunks || chunks.length < 2) return null

  return (
    <section className='flex flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-950/30 p-4'>
      <div>
        <h2 className='text-sm font-semibold text-neutral-200'>
          Concept Library
        </h2>
        <p className='text-xs text-neutral-500'>
          This article, broken into learnable pieces — study and recall one at a
          time instead of re-reading the whole thing.
        </p>
      </div>

      <ol className='flex flex-col gap-3'>
        {chunks.map((chunk, i) => (
          <li
            key={chunk.id}
            className='rounded-md border border-neutral-800 bg-neutral-900/40 p-4'
          >
            <div className='flex items-baseline justify-between gap-3'>
              <h3 className='font-medium text-neutral-100'>
                <span className='mr-2 text-neutral-600'>{i + 1}.</span>
                {chunk.title}
              </h3>
              <span className='shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
                {chunk.wordCount} words
              </span>
            </div>
            <div className='mt-3 max-h-72 overflow-y-auto border-l-2 border-neutral-800 pl-3'>
              <ArticleBlocks blocks={chunk.blocks} />
            </div>
          </li>
        ))}
      </ol>

      <p className='text-xs text-neutral-600'>
        Promoting an individual piece into its own concept is coming next.
      </p>
    </section>
  )
}
