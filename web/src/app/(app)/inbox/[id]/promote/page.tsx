'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  api,
  type GateMode,
  type PromotionState,
  type SuggestedConnection,
} from '@/lib/api'

/**
 * The Proof-of-Learning Gate (DET-189). Captured ≠ knowledge. Nothing becomes a
 * permanent concept until the user has EARNED it through four gates: articulate
 * it in your own words, connect it to what you already know, recall it from
 * memory, and validate that you've reviewed the connections. The AI asks; it
 * never authors. No answer is ever pre-filled or suggested.
 */
export default function PromoteConceptPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const router = useRouter()
  const queryClient = useQueryClient()

  // Local gate state. AI suggestions are never auto-applied — only what the
  // user explicitly approves below is ever sent to the server.
  const [mode, setMode] = useState<GateMode | null>(null)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [isRoot, setIsRoot] = useState(false)
  const [articulation, setArticulation] = useState('')
  const [recall, setRecall] = useState('')
  const [question, setQuestion] = useState<string | null>(null)
  const [grade, setGrade] = useState<{
    score: number
    passed: boolean
    feedback: string | null
  } | null>(null)

  const promotionQuery = useQuery({
    queryKey: ['promotion', id],
    queryFn: () => api.getPromotion(id),
  })

  const promotion = promotionQuery.data
  const effectiveMode: GateMode = mode ?? promotion?.suggestedMode ?? 'QUICK'

  // Seed local state from a previously-saved draft so the flow is resumable
  // (the server keeps a PromotionDraft for the full 30s–3min). Each `prev`
  // guard ensures we seed once and never clobber the user's in-progress edits.
  useEffect(() => {
    if (!promotion) return
    setArticulation((prev) =>
      prev === '' ? (promotion.draft.articulation ?? '') : prev,
    )
    setQuestion((prev) => prev ?? promotion.draft.retrievalQuestion)
    setGrade((prev) => {
      if (prev) return prev
      if (promotion.draft.retrievalScore != null) {
        return {
          score: promotion.draft.retrievalScore,
          passed: promotion.checklist.retrieve,
          feedback: null,
        }
      }
      return prev
    })
  }, [promotion])

  function applyState(updated: PromotionState) {
    queryClient.setQueryData(['promotion', id], updated)
  }

  const saveArticulation = useMutation({
    mutationFn: () => api.saveArticulation(id, articulation),
    onSuccess: (updated) => {
      applyState(updated)
      // The suggestions were drawn from the previous articulation — refetch and
      // drop prior approvals so the user reviews neighbors for what they wrote.
      setApproved(new Set())
      queryClient.invalidateQueries({ queryKey: ['promotion-connections', id] })
    },
  })

  const markReviewed = useMutation({
    mutationFn: () => api.markConnectionsReviewed(id),
    onSuccess: applyState,
  })

  const setMutationMode = useMutation({
    mutationFn: (next: GateMode) => api.setPromotionMode(id, next),
    onSuccess: applyState,
  })

  const suggestionsQuery = useQuery({
    queryKey: ['promotion-connections', id],
    queryFn: () => api.getConnectionSuggestions(id),
  })

  const generate = useMutation({
    mutationFn: () => api.generateRetrieval(id),
    onSuccess: (data) => {
      // A fresh question invalidates any prior pass — they must answer again.
      setQuestion(data.question)
      setGrade(null)
      setRecall('')
    },
  })

  const answer = useMutation({
    mutationFn: () => api.answerRetrieval(id, recall),
    onSuccess: (data) => setGrade(data),
  })

  const commit = useMutation({
    mutationFn: () =>
      api.commitPromotion(id, {
        mode: effectiveMode,
        isRoot,
        connections: [...approved].map((targetConceptId) => ({
          targetConceptId,
        })),
      }),
    onSuccess: (concept) => router.push(`/concepts/${concept.id}`),
  })

  function chooseMode(next: GateMode) {
    setMode(next)
    // DEEP mode forbids a bare root — clear it so the gate stays honest.
    if (next === 'DEEP') setIsRoot(false)
    setMutationMode.mutate(next)
  }

  function toggleApproved(targetConceptId: string) {
    setApproved((prev) => {
      const next = new Set(prev)
      if (next.has(targetConceptId)) next.delete(targetConceptId)
      else next.add(targetConceptId)
      return next
    })
  }

  // Client-side gate readiness mirrors the server's enforcement exactly. The
  // articulate gate is green only when the CURRENT text is the SAVED text — the
  // server commits the saved draft, not whatever is typed, so an unsaved edit
  // must not show as done (and must not enable commit).
  // Threshold matches the server's gate exactly (trimmed length >= 10).
  const savedArticulation = (promotion?.draft.articulation ?? '').trim()
  const articulateOk =
    savedArticulation.length >= 10 && articulation.trim() === savedArticulation
  // The Save button needs the TYPED text to be long enough and to differ from
  // what's already saved (otherwise there's nothing to persist).
  const canSave =
    articulation.trim().length >= 10 &&
    articulation.trim() !== savedArticulation
  const connectOk =
    effectiveMode === 'DEEP' ? approved.size >= 1 : approved.size >= 1 || isRoot
  const retrieveOk = grade?.passed === true
  // Gate 4 is server-recorded — read it back from the draft, don't self-assert.
  const validateOk = promotion?.draft.connectionsReviewed === true
  const ready = articulateOk && connectOk && retrieveOk && validateOk

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <Link
          href={`/inbox/${id}`}
          className='text-sm text-neutral-400 hover:underline'
        >
          ← Back
        </Link>
        <h1 className='mt-2 text-2xl font-semibold'>Earn this concept</h1>
        <p className='text-sm text-neutral-400'>
          {promotion?.title ?? 'Loading…'} — nothing becomes permanent until
          you’ve understood it well enough to recall it. We ask; we don’t
          author.
        </p>
      </div>

      {promotionQuery.isLoading && <p className='text-neutral-400'>Loading…</p>}
      {promotionQuery.isError && (
        <div className='rounded-lg border border-amber-700/50 bg-amber-950/10 p-4'>
          <p className='text-sm text-amber-300/90'>
            {promotionQuery.error instanceof Error
              ? promotionQuery.error.message
              : 'Could not start promotion.'}
          </p>
        </div>
      )}

      {promotion && (
        <>
          <GateChecklist
            articulate={articulateOk}
            connect={articulateOk && connectOk}
            retrieve={articulateOk && retrieveOk}
            validate={validateOk}
          />

          {promotion.sourceText && (
            <section className='max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950/50 p-4 text-sm text-neutral-400'>
              {promotion.sourceText}
            </section>
          )}

          {/* Mode picker */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>Depth</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                How rigorously do you want to earn this?
              </p>
            </div>
            <div className='flex gap-2'>
              {(['QUICK', 'DEEP'] as GateMode[]).map((m) => (
                <button
                  key={m}
                  type='button'
                  onClick={() => chooseMode(m)}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    effectiveMode === m
                      ? 'bg-neutral-100 text-black'
                      : 'border border-neutral-700 text-neutral-300 hover:bg-neutral-900'
                  }`}
                >
                  {m}
                  {promotion.suggestedMode === m && (
                    <span className='ml-1.5 text-[10px] uppercase tracking-wide opacity-60'>
                      suggested
                    </span>
                  )}
                </button>
              ))}
            </div>
            {effectiveMode === 'DEEP' && (
              <p className='text-xs text-neutral-500'>
                Deep mode requires at least one real connection — a bare root
                isn’t allowed.
              </p>
            )}
          </section>

          {/* 1. Articulate */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>
                {articulateOk ? '✓' : '○'} 1. Articulate
              </h2>
              <p className='mt-1 text-sm text-neutral-500'>
                Explain it in your own words. Don’t quote the source — show that
                you understand it.
              </p>
            </div>
            <textarea
              value={articulation}
              onChange={(e) => setArticulation(e.target.value)}
              placeholder='In your own words…'
              rows={4}
              className='resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400'
            />
            {saveArticulation.isError && (
              <p className='text-sm text-red-400'>
                {saveArticulation.error instanceof Error
                  ? saveArticulation.error.message
                  : 'Failed to save.'}
              </p>
            )}
            <div className='flex items-center gap-3'>
              <button
                type='button'
                disabled={saveArticulation.isPending || !canSave}
                onClick={() => saveArticulation.mutate()}
                className='self-start rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
              >
                {saveArticulation.isPending ? 'Saving…' : 'Save articulation'}
              </button>
              {saveArticulation.isSuccess && !saveArticulation.isPending && (
                <span className='text-sm text-green-400'>Saved.</span>
              )}
            </div>
          </section>

          {/* 2. Connect + 4. Validate */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>
                {connectOk ? '✓' : '○'} 2. Connect
                <span className='ml-2 text-neutral-500'>
                  {validateOk ? '✓' : '○'} 4. Validate
                </span>
              </h2>
              <p className='mt-1 text-sm text-neutral-500'>
                Tie this to what you already know. We suggest neighbors — you
                decide which are real.
              </p>
            </div>

            {suggestionsQuery.isLoading && (
              <p className='text-sm text-neutral-400'>Finding neighbors…</p>
            )}
            {suggestionsQuery.isError && (
              <p className='text-sm text-red-400'>
                {suggestionsQuery.error instanceof Error
                  ? suggestionsQuery.error.message
                  : 'Could not load suggestions.'}
              </p>
            )}

            {suggestionsQuery.data && suggestionsQuery.data.length === 0 && (
              <p className='text-sm text-neutral-500'>
                No neighbors suggested.{' '}
                {effectiveMode === 'QUICK'
                  ? 'You can mark this as a new conceptual root below.'
                  : 'Deep mode needs a connection — try quick mode if this stands alone.'}
              </p>
            )}

            {suggestionsQuery.data && suggestionsQuery.data.length > 0 && (
              <ul className='flex flex-col gap-2'>
                {suggestionsQuery.data.map((s) => (
                  <SuggestionRow
                    key={s.targetConceptId}
                    suggestion={s}
                    approved={approved.has(s.targetConceptId)}
                    onToggle={() => toggleApproved(s.targetConceptId)}
                  />
                ))}
              </ul>
            )}

            <label
              className={`flex items-center gap-2 text-sm ${
                effectiveMode === 'DEEP'
                  ? 'cursor-not-allowed text-neutral-600'
                  : 'cursor-pointer text-neutral-300'
              }`}
            >
              <input
                type='checkbox'
                checked={isRoot}
                disabled={effectiveMode === 'DEEP'}
                onChange={(e) => setIsRoot(e.target.checked)}
              />
              This is a new conceptual root.
              {effectiveMode === 'DEEP' && (
                <span className='text-xs text-neutral-600'>
                  (not allowed in deep mode)
                </span>
              )}
            </label>

            {markReviewed.isError && (
              <p className='text-sm text-red-400'>
                {markReviewed.error instanceof Error
                  ? markReviewed.error.message
                  : 'Could not record your review.'}
              </p>
            )}
            <button
              type='button'
              onClick={() => markReviewed.mutate()}
              disabled={!connectOk || validateOk || markReviewed.isPending}
              className='self-start rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900 disabled:opacity-50'
            >
              {validateOk
                ? 'Connections reviewed ✓'
                : markReviewed.isPending
                  ? 'Saving…'
                  : 'I’ve reviewed these connections'}
            </button>
          </section>

          {/* 3. Retrieve */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>
                {retrieveOk ? '✓' : '○'} 3. Retrieve
              </h2>
              <p className='mt-1 text-sm text-neutral-500'>
                Prove you can recall it from memory — without looking back.
              </p>
            </div>

            {generate.isError && (
              <p className='text-sm text-red-400'>
                {generate.error instanceof Error
                  ? generate.error.message
                  : 'Could not generate a question.'}
              </p>
            )}

            {!articulateOk && (
              <p className='text-sm text-neutral-500'>
                Save your articulation first — the question is drawn from it.
              </p>
            )}
            <button
              type='button'
              onClick={() => generate.mutate()}
              disabled={generate.isPending || !articulateOk}
              className='self-start rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900 disabled:opacity-50'
            >
              {generate.isPending
                ? 'Thinking…'
                : question
                  ? 'Generate a new question'
                  : 'Generate a question'}
            </button>

            {question && (
              <>
                <p className='font-medium text-neutral-100'>{question}</p>
                <textarea
                  value={recall}
                  onChange={(e) => setRecall(e.target.value)}
                  placeholder='Answer from memory…'
                  rows={4}
                  className='resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400'
                />
                {answer.isError && (
                  <p className='text-sm text-red-400'>
                    {answer.error instanceof Error
                      ? answer.error.message
                      : 'Could not grade your answer.'}
                  </p>
                )}
                <button
                  type='button'
                  onClick={() => answer.mutate()}
                  disabled={answer.isPending || !recall.trim()}
                  className='self-start rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
                >
                  {answer.isPending ? 'Grading…' : 'Submit answer'}
                </button>
                {grade && (
                  <div
                    className={`rounded-md border p-3 text-sm ${
                      grade.passed
                        ? 'border-green-700/50 bg-green-950/10 text-green-300/90'
                        : 'border-amber-700/50 bg-amber-950/10 text-amber-300/90'
                    }`}
                  >
                    <p className='font-medium'>
                      {grade.passed ? 'Passed' : 'Not yet'} — {grade.score}/5
                    </p>
                    {grade.feedback && <p className='mt-1'>{grade.feedback}</p>}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Commit */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <p className='text-sm text-neutral-400'>
              You can only save this once you’ve understood it well enough to
              recall it.
            </p>
            {commit.isError && (
              <p className='text-sm text-red-400'>
                {commit.error instanceof Error
                  ? commit.error.message
                  : 'Could not commit.'}
              </p>
            )}
            <button
              type='button'
              onClick={() => commit.mutate()}
              disabled={!ready || commit.isPending}
              className='self-start rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
            >
              {commit.isPending ? 'Committing…' : 'Commit as a concept'}
            </button>
          </section>
        </>
      )}
    </div>
  )
}

function GateChecklist({
  articulate,
  connect,
  retrieve,
  validate,
}: {
  articulate: boolean
  connect: boolean
  retrieve: boolean
  validate: boolean
}) {
  const gates: { label: string; done: boolean }[] = [
    { label: 'Articulate', done: articulate },
    { label: 'Connect', done: connect },
    { label: 'Retrieve', done: retrieve },
    { label: 'Validate', done: validate },
  ]
  return (
    <ul className='flex flex-wrap gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
      {gates.map((g) => (
        <li
          key={g.label}
          className={`flex items-center gap-2 text-sm ${
            g.done ? 'text-green-400' : 'text-neutral-500'
          }`}
        >
          <span>{g.done ? '✓' : '○'}</span>
          {g.label}
        </li>
      ))}
    </ul>
  )
}

function SuggestionRow({
  suggestion,
  approved,
  onToggle,
}: {
  suggestion: SuggestedConnection
  approved: boolean
  onToggle: () => void
}) {
  return (
    <li
      className={`rounded-md border p-3 transition ${
        approved
          ? 'border-green-700/50 bg-green-950/10'
          : 'border-neutral-800 bg-neutral-950/50'
      }`}
    >
      <label className='flex cursor-pointer items-start gap-2'>
        <input
          type='checkbox'
          checked={approved}
          onChange={onToggle}
          className='mt-1'
        />
        <span className='flex flex-col gap-1'>
          <span className='flex items-center gap-2'>
            <span className='font-medium text-neutral-100'>
              {suggestion.title}
            </span>
            <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
              {Math.round(suggestion.similarity * 100)}%
            </span>
          </span>
          {suggestion.snippet && (
            <span className='line-clamp-2 text-sm text-neutral-400'>
              {suggestion.snippet}
            </span>
          )}
        </span>
      </label>
    </li>
  )
}
