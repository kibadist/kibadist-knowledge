'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { ArticleReader } from '@/components/reader/article-reader'
import {
  api,
  type FrictionLevel,
  type LinkRelation,
  type PromotionState,
  type SuggestedConnection,
} from '@/lib/api'

// Adaptive Friction (DET-197): which gates each level requires. Mirrors the
// server's requiredGates() so the UI shows a not-required gate as satisfied.
const FRICTION_GATES: Record<
  FrictionLevel,
  { connect: boolean; retrieve: boolean; validate: boolean }
> = {
  MINIMAL: { connect: false, retrieve: false, validate: false },
  LIGHT: { connect: true, retrieve: false, validate: false },
  DEEP: { connect: true, retrieve: true, validate: true },
  RIGOROUS: { connect: true, retrieve: true, validate: true },
}

const FRICTION_LEVELS: FrictionLevel[] = [
  'MINIMAL',
  'LIGHT',
  'DEEP',
  'RIGOROUS',
]

const FRICTION_BLURB: Record<FrictionLevel, string> = {
  MINIMAL: 'A compression is enough — for a short, familiar clip.',
  LIGHT: 'Articulate and connect it to what you already know.',
  DEEP: 'The full gate: articulate, connect, recall, and validate.',
  RIGOROUS: 'Full gate plus a post-promotion Tutor + contradiction pass.',
}

// DET-191: relation chip styling. CONTRADICTION and REDUNDANT are flagged
// distinctly (amber / red) so a conflicting or duplicative neighbor stands out
// from ordinary structural relations.
const RELATION_LABELS: Record<LinkRelation, string> = {
  ANALOGY: 'analogy',
  CONTRADICTION: 'contradiction',
  SUPPORTS: 'supports',
  DEPENDS_ON: 'depends on',
  REFINES: 'refines',
  REDUNDANT: 'redundant',
}

function relationChipClass(kind: LinkRelation): string {
  if (kind === 'CONTRADICTION')
    return 'border-red-700/60 bg-red-950/30 text-red-300'
  if (kind === 'REDUNDANT')
    return 'border-amber-700/60 bg-amber-950/30 text-amber-300'
  return 'border-neutral-700 text-neutral-400'
}

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
  // Concept Library handoff (DET-211): if we arrived from a candidate, its
  // label + definition come back as DISPLAY-ONLY reference context. It is never
  // prefilled into the articulation field below (DET-190 no-prefill invariant).
  const searchParams = useSearchParams()
  const candidateId = searchParams.get('candidateId') ?? undefined

  // Local gate state. AI suggestions are never auto-applied — only what the
  // user explicitly approves below is ever sent to the server.
  const [level, setLevel] = useState<FrictionLevel | null>(null)
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
    queryKey: ['promotion', id, candidateId ?? null],
    queryFn: () => api.getPromotion(id, candidateId),
  })

  const promotion = promotionQuery.data
  // The chosen level comes from the server draft; local state mirrors it for
  // optimistic UI between a click and the refetch.
  const effectiveLevel: FrictionLevel =
    level ?? promotion?.frictionLevel ?? 'DEEP'
  const requiredGates = FRICTION_GATES[effectiveLevel]

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
    queryClient.setQueryData(['promotion', id, candidateId ?? null], updated)
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

  const setMutationFriction = useMutation({
    mutationFn: (next: FrictionLevel) => api.setFriction(id, next),
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
    mutationFn: () => {
      // Carry the Connector's typed relationKind through on each approved edge
      // (DET-191), looked up from the suggestion the user checked.
      const relationByTarget = new Map<string, LinkRelation>(
        (suggestionsQuery.data ?? []).map((s) => [
          s.targetConceptId,
          s.relationKind,
        ]),
      )
      return api.commitPromotion(id, {
        isRoot,
        connections: [...approved].map((targetConceptId) => ({
          targetConceptId,
          relationKind: relationByTarget.get(targetConceptId),
        })),
      })
    },
    onSuccess: (concept) => router.push(`/concepts/${concept.id}`),
  })

  function chooseLevel(next: FrictionLevel) {
    setLevel(next)
    // Any level that requires a connection forbids a bare root — clear it so the
    // gate stays honest.
    if (FRICTION_GATES[next].connect) setIsRoot(false)
    setMutationFriction.mutate(next)
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
  // Each gate is "satisfied, OR not required at this friction level" — mirroring
  // the server's evaluateGates so the UI matches enforcement exactly.
  const hasLink = approved.size >= 1
  const connectOk = !requiredGates.connect || hasLink
  const retrieveOk = !requiredGates.retrieve || grade?.passed === true
  // Gate 4 is server-recorded — read it back from the draft, don't self-assert.
  const validateOk =
    !requiredGates.validate || promotion?.draft.connectionsReviewed === true
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
            <ArticleReader
              document={promotion.sourceDocument}
              content={promotion.sourceText}
              variant='compact'
              showHeader={false}
              storageKey={`promote-${id}`}
            />
          )}

          {/* Friction picker (DET-197) */}
          <section className='flex flex-col gap-3 rounded-lg border border-neutral-800 p-4'>
            <div>
              <h2 className='font-medium'>How rigorously to earn this</h2>
              <p className='mt-1 text-sm text-neutral-500'>
                We suggest a level from how new and substantial this looks. You
                choose — escalate or de-escalate in one click.
              </p>
            </div>
            <div className='rounded-md border border-neutral-800 bg-neutral-950/40 p-3'>
              <p className='text-sm'>
                <span className='font-medium text-neutral-200'>
                  Suggested: {promotion.frictionProposal.level}
                </span>
                {promotion.frictionProposal.reasons.length > 0 && (
                  <span className='text-neutral-500'>
                    {' '}
                    — {promotion.frictionProposal.reasons.join(' ')}
                  </span>
                )}
              </p>
            </div>
            <div className='flex flex-wrap gap-2'>
              {FRICTION_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type='button'
                  onClick={() => chooseLevel(lvl)}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    effectiveLevel === lvl
                      ? 'bg-neutral-100 text-black'
                      : 'border border-neutral-700 text-neutral-300 hover:bg-neutral-900'
                  }`}
                >
                  {lvl}
                  {promotion.frictionProposal.level === lvl && (
                    <span className='ml-1.5 text-[10px] uppercase tracking-wide opacity-60'>
                      suggested
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className='text-xs text-neutral-500'>
              {FRICTION_BLURB[effectiveLevel]}
              {requiredGates.connect &&
                ' This level requires at least one real connection — a bare root isn’t allowed.'}
            </p>
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
              {/* Compression facets (DET-190): what a strong own-words
                  articulation contains. Guidance only — we never write it for you. */}
              <ul className='mt-2 flex flex-col gap-0.5 text-xs text-neutral-600'>
                <li>• State the central claim in 1–3 plain sentences.</li>
                <li>• Explain it as if to a smart friend, not an expert.</li>
                <li>• What would have to be true for this to be wrong?</li>
                <li>• What are you NOT claiming? (scope)</li>
              </ul>
            </div>
            {promotion.referenceQa.length > 0 && (
              <details className='rounded-md border border-neutral-800 bg-neutral-950/40 p-3'>
                <summary className='cursor-pointer text-xs uppercase tracking-wide text-neutral-500'>
                  Your reference Q&A ({promotion.referenceQa.length}) — scaffold
                  only
                </summary>
                <p className='mt-2 text-xs text-neutral-600'>
                  What you explored while reading. For reference only — write
                  your own words above; we won’t fill this in for you.
                </p>
                <ul className='mt-2 flex flex-col gap-2'>
                  {promotion.referenceQa.map((qa, i) => (
                    <li
                      key={i}
                      className='border-l border-neutral-700 pl-3 text-sm'
                    >
                      <p className='text-neutral-300'>{qa.questionText}</p>
                      <p className='mt-0.5 text-neutral-500'>{qa.answerText}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {/* Concept Library reference context (DET-211). DISPLAY-ONLY: the
                candidate's source-grounded gloss is shown so the user knows what
                they're earning. It is deliberately NOT written into the textarea
                below — the articulation stays the user's own words (DET-190). */}
            {promotion.candidateContext && (
              <div className='rounded-md border border-neutral-800 bg-neutral-950/40 p-3'>
                <span className='inline-block rounded border border-amber-700/40 bg-amber-950/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300/80'>
                  From the article · reference only
                </span>
                <p className='mt-1.5 text-sm font-medium text-neutral-200'>
                  {promotion.candidateContext.label}
                </p>
                {promotion.candidateContext.definition && (
                  <p className='mt-1 text-sm text-neutral-500'>
                    {promotion.candidateContext.definition}
                  </p>
                )}
                <p className='mt-1.5 text-xs text-neutral-600'>
                  This is the source’s gloss, for reference. Write your own
                  understanding below — we won’t fill it in for you.
                </p>
              </div>
            )}
            <textarea
              value={articulation}
              onChange={(e) => setArticulation(e.target.value)}
              placeholder='In your own words…'
              rows={4}
              className='resize-y rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400'
            />
            {/* Verbatim-copy nudge (DET-190): the saved articulation is too
                close to the source. We flag, never rewrite — the gate stays
                blocked until it's in the user's own words. */}
            {promotion.compression.verbatim &&
              promotion.compression.message && (
                <p className='rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300'>
                  {promotion.compression.message}
                </p>
              )}
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
              <div className='flex flex-col gap-2'>
                <p className='text-sm text-neutral-500'>
                  No neighbors suggested.{' '}
                  {requiredGates.connect
                    ? 'This level needs a connection — drop to Minimal if this stands alone.'
                    : 'You can mark this as a new conceptual root below.'}
                </p>
                {/* When there is nothing to link to AND this level requires a
                    connection, the only honest path is to treat the concept as a
                    standalone clip — which is exactly MINIMAL (a compression is
                    enough). The escape already lives in the friction picker above;
                    this surfaces it as a one-click action so the stuck state isn't
                    a dead end. No gate semantics change — chooseLevel() is the same
                    deliberate de-escalation the picker performs. */}
                {requiredGates.connect && (
                  <button
                    type='button'
                    onClick={() => chooseLevel('MINIMAL')}
                    disabled={setMutationFriction.isPending}
                    className='self-start rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900 disabled:opacity-50'
                  >
                    {setMutationFriction.isPending
                      ? 'Switching…'
                      : 'Drop to Minimal — this stands alone'}
                  </button>
                )}
              </div>
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
                requiredGates.connect
                  ? 'cursor-not-allowed text-neutral-600'
                  : 'cursor-pointer text-neutral-300'
              }`}
            >
              <input
                type='checkbox'
                checked={isRoot}
                disabled={requiredGates.connect}
                onChange={(e) => setIsRoot(e.target.checked)}
              />
              This is a new conceptual root.
              {requiredGates.connect && (
                <span className='text-xs text-neutral-600'>
                  (not allowed at this level)
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
          <span className='flex flex-wrap items-center gap-2'>
            <span className='font-medium text-neutral-100'>
              {suggestion.title}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${relationChipClass(
                suggestion.relationKind,
              )}`}
            >
              {RELATION_LABELS[suggestion.relationKind]}
            </span>
            <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
              {Math.round(suggestion.similarity * 100)}%
            </span>
          </span>
          {suggestion.rationale && (
            <span className='text-sm text-neutral-400'>
              {suggestion.rationale}
            </span>
          )}
        </span>
      </label>
    </li>
  )
}
