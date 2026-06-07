'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  ArticleReader,
  ReaderError,
  ReaderSkeleton,
} from '@/components/reader/article-reader'
import {
  api,
  type CandidateImportance,
  type ChunkImportance,
  type ChunkKind,
  type ConceptLibrary,
  type IntakeQuestion,
  type SourceChunk,
  type SourceConceptCandidate,
  type SourceQuestion,
} from '@/lib/api'
import { CANDIDATE_KIND_LABELS } from '@/lib/labels'

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
    <div className='screen'>
      <div className='page-head'>
        <Link href='/inbox' className='back-link'>
          ← Back to inbox
        </Link>
        <span className='section-label'>§ Process</span>
        <h1>{itemQuery.data?.title ?? 'Processing…'}</h1>
        <p className='lede'>
          Answer in your own words. We ask the questions — we won’t write your
          understanding for you.
        </p>
        <Link href={`/inbox/${id}/promote`} className='btn-primary'>
          Promote to a concept
          <span className='ar'>→</span>
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
        <p className='notice'>Reading it and thinking up questions…</p>
      )}
      {questionsQuery.isError && (
        <div className='callout-pending'>
          <p className='notice notice-error'>
            {questionsQuery.error instanceof Error
              ? questionsQuery.error.message
              : 'Could not generate questions.'}
          </p>
          <button
            type='button'
            onClick={() => questionsQuery.refetch()}
            className='btn-ghost'
            style={{ marginTop: 8 }}
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
          className='doc-section'
        >
          <h2 className='panel-h'>Interrogation</h2>
          <ol className='flex flex-col gap-4'>
            {questionsQuery.data.map((q, i) => (
              <li key={q.id} className='item-card flex flex-col gap-2'>
                <div className='flex items-baseline gap-2'>
                  <span className='u-mono text-sm text-ink-muted'>
                    {i + 1}.
                  </span>
                  {q.kind && KIND_LABEL[q.kind] && (
                    <span className='chip chip-quiet'>
                      {KIND_LABEL[q.kind]}
                    </span>
                  )}
                </div>
                <p className='font-medium text-ink'>{q.prompt}</p>
                <textarea
                  value={answers[q.id] ?? ''}
                  onChange={(e) => {
                    setSaved(false)
                    setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }}
                  placeholder='Your answer, in your own words…'
                  rows={3}
                  className='fld'
                />
              </li>
            ))}
          </ol>

          {save.isError && (
            <p className='notice notice-error'>
              {save.error instanceof Error
                ? save.error.message
                : 'Failed to save answers'}
            </p>
          )}

          <div className='flex items-center gap-3'>
            <button
              type='submit'
              disabled={save.isPending}
              className='btn-primary'
            >
              {save.isPending ? 'Saving…' : 'Save my answers'}
              <span className='ar'>→</span>
            </button>
            {saved && !save.isPending && (
              <span className='notice notice-ok'>Saved.</span>
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
    <section className='doc-section flat'>
      <div>
        <h2 className='panel-h'>Ask about the source</h2>
        <p className='block-sub'>
          Answers are grounded in the text to help you read. They’re reference
          scaffold — not your knowledge. You’ll still articulate it yourself.
        </p>
      </div>

      {historyQuery.data && historyQuery.data.length > 0 && (
        <ul className='flex flex-col gap-3'>
          {historyQuery.data.map((entry) => (
            <li key={entry.id} className='item-card'>
              <div className='flex items-start justify-between gap-2'>
                <p className='font-medium text-ink'>{entry.questionText}</p>
                <button
                  type='button'
                  onClick={() => remove.mutate(entry.id)}
                  className='shrink-0 u-mono text-xs text-ink-faint transition hover:text-accent'
                  aria-label='Discard this question'
                >
                  ✕
                </button>
              </div>
              {entry.answerText && (
                <div
                  className='mt-2'
                  style={{
                    borderLeft: '2px solid var(--ochre)',
                    paddingLeft: 12,
                  }}
                >
                  <span className='chip chip-pending'>
                    Reference · AI scaffold
                  </span>
                  <p className='mt-1.5 whitespace-pre-wrap text-sm text-ink-muted'>
                    {entry.answerText}
                  </p>
                  {entry.citations.length > 0 && (
                    <ul className='mt-2 flex flex-col gap-1'>
                      {entry.citations.map((c, i) => (
                        <li
                          key={i}
                          className='pl-2 text-xs italic text-ink-muted'
                          style={{ borderLeft: '1px solid var(--rule-soft)' }}
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
          className='fld'
        />
        {ask.isError && (
          <p className='notice notice-error'>
            {ask.error instanceof Error
              ? ask.error.message
              : 'Could not answer right now'}
          </p>
        )}
        <button
          type='submit'
          disabled={ask.isPending || !trimmed}
          className='btn-ghost'
        >
          {ask.isPending ? 'Asking…' : 'Ask the source'}
        </button>
      </form>
    </section>
  )
}

// Human labels for chunk kinds. REFERENCE/NOISE chunks are collapsed by default.
const CHUNK_KIND_LABEL: Record<ChunkKind, string> = {
  MAIN_IDEA: 'Main idea',
  DEFINITION: 'Definition',
  EXAMPLE: 'Example',
  APPLICATION: 'Application',
  HISTORY: 'History',
  REFERENCE: 'Reference',
  NOISE: 'Noise',
  OTHER: 'Section',
}

const CHUNK_IMPORTANCE_LABEL: Record<ChunkImportance, string> = {
  CORE: 'core',
  SUPPORTING: 'supporting',
  PERIPHERAL: 'peripheral',
}

const CANDIDATE_IMPORTANCE_LABEL: Record<CandidateImportance, string> = {
  CORE: 'core',
  SUPPORTING: 'supporting',
  PREREQUISITE: 'prerequisite',
  PERIPHERAL: 'peripheral',
}

// Chunks that are reference lists / boilerplate add little to study — collapse
// them by default so the learnable sections lead.
function isLowSignalChunk(kind: ChunkKind): boolean {
  return kind === 'REFERENCE' || kind === 'NOISE'
}

// Rank for ordering: CORE concepts surface first within a chunk.
const IMPORTANCE_RANK: Record<CandidateImportance, number> = {
  CORE: 0,
  PREREQUISITE: 1,
  SUPPORTING: 2,
  PERIPHERAL: 3,
}

/**
 * The Concept Library (DET-211). A captured article bundles many cognitive
 * objects into one wall of text. Here we surface it as the concepts it
 * introduces, grouped by section, CORE concepts first — so the article becomes
 * something you study one idea at a time.
 *
 * HARD BOUNDARY: everything shown here is SCAFFOLD / source material, never an
 * earned concept. A candidate's definition is a source-grounded reference gloss
 * — "Compress this" hands it to the gate as DISPLAY-ONLY context; it is never
 * prefilled into your articulation (DET-190). Only the gate promotes knowledge.
 */
function ConceptLibraryPanel({ inboxId }: { inboxId: string }) {
  const queryClient = useQueryClient()
  const router = useRouter()

  const libraryQuery = useQuery({
    queryKey: ['concept-library', inboxId],
    queryFn: () => api.getConceptLibrary(inboxId),
  })

  const regenerate = useMutation({
    mutationFn: () => api.regenerateConceptLibrary(inboxId),
    onSuccess: (data) =>
      queryClient.setQueryData(['concept-library', inboxId], data),
  })

  const dismiss = useMutation({
    mutationFn: (candidateId: string) => api.dismissCandidate(candidateId),
    onSuccess: (_void, candidateId) => {
      queryClient.setQueryData<ConceptLibrary>(
        ['concept-library', inboxId],
        (prev) =>
          prev
            ? {
                ...prev,
                candidates: prev.candidates.filter((c) => c.id !== candidateId),
              }
            : prev,
      )
    },
  })

  const library = libraryQuery.data
  // An empty or single-chunk library with no candidates gains nothing — hide it.
  if (
    !library ||
    (library.chunks.length < 2 && library.candidates.length === 0)
  ) {
    return null
  }

  // Group candidates under their owning chunk; keep chunk reading order.
  const candidatesByChunk = new Map<string | null, SourceConceptCandidate[]>()
  for (const cand of library.candidates) {
    const list = candidatesByChunk.get(cand.chunkId) ?? []
    list.push(cand)
    candidatesByChunk.set(cand.chunkId, list)
  }
  for (const list of candidatesByChunk.values()) {
    list.sort(
      (a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance],
    )
  }

  return (
    <section className='doc-section flat'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h2 className='panel-h'>Concepts in this article</h2>
          <p className='block-sub'>
            What this article introduces, grouped by section. These are
            reference scaffold — not your knowledge. You earn each one through
            the gate.
          </p>
        </div>
        <button
          type='button'
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
          className='btn-ghost-xs shrink-0'
        >
          {regenerate.isPending ? 'Rebuilding…' : 'Rebuild'}
        </button>
      </div>

      <ol className='flex flex-col gap-3'>
        {library.chunks.map((chunk) => (
          <ChunkGroup
            key={chunk.id}
            inboxId={inboxId}
            chunk={chunk}
            candidates={candidatesByChunk.get(chunk.id) ?? []}
            onCompress={(candidateId) =>
              router.push(
                `/inbox/${inboxId}/promote?candidateId=${encodeURIComponent(candidateId)}`,
              )
            }
            onDismiss={(candidateId) => dismiss.mutate(candidateId)}
          />
        ))}
      </ol>
    </section>
  )
}

function ChunkGroup({
  inboxId,
  chunk,
  candidates,
  onCompress,
  onDismiss,
}: {
  inboxId: string
  chunk: SourceChunk
  candidates: SourceConceptCandidate[]
  onCompress: (candidateId: string) => void
  onDismiss: (candidateId: string) => void
}) {
  // Low-signal sections (references, boilerplate) collapse by default.
  const lowSignal = isLowSignalChunk(chunk.kind)

  return (
    <li className='item-card'>
      <details open={!lowSignal}>
        <summary className='flex cursor-pointer flex-wrap items-center gap-2'>
          <h3 className='font-medium text-ink'>{chunk.title ?? 'Section'}</h3>
          <span className='chip chip-quiet'>
            {CHUNK_KIND_LABEL[chunk.kind]}
          </span>
          <span
            className={`chip ${chunk.importance === 'CORE' ? 'chip-cleared' : 'chip-quiet'}`}
          >
            {CHUNK_IMPORTANCE_LABEL[chunk.importance]}
          </span>
          {candidates.length > 0 && (
            <span className='u-mono text-xs text-ink-faint'>
              {candidates.length} concept{candidates.length === 1 ? '' : 's'}
            </span>
          )}
        </summary>

        {candidates.length === 0 ? (
          <p className='mt-3 text-xs text-ink-faint'>
            No distinct concepts extracted from this section.
          </p>
        ) : (
          <ul className='mt-3 flex flex-col gap-2'>
            {candidates.map((cand) => (
              <CandidateRow
                key={cand.id}
                inboxId={inboxId}
                candidate={cand}
                onCompress={() => onCompress(cand.id)}
                onDismiss={() => onDismiss(cand.id)}
              />
            ))}
          </ul>
        )}
      </details>
    </li>
  )
}

function CandidateRow({
  inboxId,
  candidate,
  onCompress,
  onDismiss,
}: {
  inboxId: string
  candidate: SourceConceptCandidate
  onCompress: () => void
  onDismiss: () => void
}) {
  const [askOpen, setAskOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)

  // Ask scoped to THIS candidate's source blocks (DET-211 scoped Q&A). The answer
  // is reference scaffold, shown transiently — never saved as knowledge.
  const ask = useMutation({
    mutationFn: (q: string) =>
      api.askSourceQuestion(inboxId, q, { candidateId: candidate.id }),
    onSuccess: (created) => {
      setAnswer(created.answerText)
      setQuestion('')
    },
  })

  return (
    <li className='item-card'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium text-ink'>{candidate.label}</span>
        <span className='chip chip-quiet'>
          {CANDIDATE_KIND_LABELS[candidate.kind]}
        </span>
        <span
          className={`chip ${candidate.importance === 'CORE' ? 'chip-cleared' : 'chip-quiet'}`}
        >
          {CANDIDATE_IMPORTANCE_LABEL[candidate.importance]}
        </span>
      </div>

      {candidate.definition && (
        <details className='mt-1.5'>
          <summary className='cursor-pointer u-mono text-xs uppercase text-ink-muted'>
            Source-grounded definition (reference)
          </summary>
          <p
            className='mt-1 block-sub'
            style={{ borderLeft: '2px solid var(--ochre)', paddingLeft: 12 }}
          >
            {candidate.definition}
          </p>
        </details>
      )}

      <div className='mt-2 flex flex-wrap gap-2'>
        <button
          type='button'
          onClick={() => setAskOpen((v) => !v)}
          className='btn-ghost-xs'
        >
          Ask about this
        </button>
        <button type='button' onClick={onCompress} className='btn-primary'>
          Compress this
          <span className='ar'>→</span>
        </button>
        <button type='button' onClick={onDismiss} className='btn-ghost-xs'>
          Dismiss
        </button>
      </div>

      {askOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = question.trim()
            if (trimmed) ask.mutate(trimmed)
          }}
          className='mt-2 flex flex-col gap-2'
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`Ask about “${candidate.label}”…`}
            className='fld'
          />
          {ask.isError && (
            <p className='notice notice-error'>
              {ask.error instanceof Error
                ? ask.error.message
                : 'Could not answer right now'}
            </p>
          )}
          <button
            type='submit'
            disabled={ask.isPending || !question.trim()}
            className='btn-ghost-xs'
          >
            {ask.isPending ? 'Asking…' : 'Ask'}
          </button>
          {answer && (
            <div
              style={{ borderLeft: '2px solid var(--ochre)', paddingLeft: 12 }}
            >
              <span className='chip chip-pending'>Reference · AI scaffold</span>
              <p className='mt-1.5 whitespace-pre-wrap text-sm text-ink-muted'>
                {answer}
              </p>
            </div>
          )}
        </form>
      )}
    </li>
  )
}
