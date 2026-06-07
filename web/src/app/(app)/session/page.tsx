'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/empty-state'
import {
  api,
  type ReflectionKind,
  type Session,
  type SessionItem,
} from '@/lib/api'
// Humanized labels (DET-304): one source of truth for every enum label.
import { SESSION_ITEM_REASON_LABELS } from '@/lib/labels'

/**
 * Understanding Session (DET-198) — the daily 5–15 minute loop. The system
 * resurfaces earned concepts as questions: for each, you retrieve the answer
 * from memory, then reveal your own compression and self-rate the recall. This
 * is recall practice that builds understanding, not a flashcard grind. It closes
 * with a brief, skippable Reflection step (DET-196) where the user notes what
 * MOVED in their understanding.
 */
export default function SessionPage() {
  const queryClient = useQueryClient()

  const activeQuery = useQuery({
    queryKey: ['session', 'active'],
    queryFn: () => api.getActiveSession(),
  })

  const session = activeQuery.data

  if (activeQuery.isLoading) {
    return <p className='notice'>Loading session…</p>
  }

  if (!session) {
    return (
      <StartScreen
        onStarted={(started) => {
          queryClient.setQueryData(['session', 'active'], started)
        }}
      />
    )
  }

  return <RunningSession session={session} />
}

const TARGET_OPTIONS = [5, 10, 15, 20, 30] as const

function StartScreen({ onStarted }: { onStarted: (s: Session) => void }) {
  const [targetMinutes, setTargetMinutes] = useState(10)

  const start = useMutation({
    mutationFn: () => api.startSession(targetMinutes),
    onSuccess: onStarted,
  })

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Recall · The daily loop</div>
        <h1>Session</h1>
        <p className='lede'>
          The system resurfaces concepts as questions, so you rebuild
          understanding instead of rereading.
        </p>
      </div>

      <section className='panel panel-raised'>
        <h3 className='block-h'>How long do you have?</h3>
        <p className='block-sub'>
          We’ll build a queue to fit. Five focused minutes beats an hour of
          rereading.
        </p>
        <div className='seg-row' style={{ marginTop: 18 }}>
          {TARGET_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type='button'
              onClick={() => setTargetMinutes(minutes)}
              aria-pressed={targetMinutes === minutes}
              className={`seg${targetMinutes === minutes ? ' on' : ''}`}
            >
              {minutes} min
            </button>
          ))}
        </div>
        <button
          type='button'
          onClick={() => start.mutate()}
          disabled={start.isPending}
          className='btn-primary'
          style={{ marginTop: 22 }}
        >
          {start.isPending ? 'Starting…' : 'Start session'}{' '}
          <span className='ar'>→</span>
        </button>
        {start.isError && (
          <p className='notice notice-error' style={{ marginTop: 12 }}>
            Could not start a session. Try again.
          </p>
        )}
      </section>
    </div>
  )
}

function RunningSession({ session }: { session: Session }) {
  const queryClient = useQueryClient()
  // Walk items in order. We track the index locally; reviewed state advances it.
  const firstUnreviewed = session.items.findIndex((i) => i.reviewedAt === null)
  const [index, setIndex] = useState(
    firstUnreviewed === -1 ? session.items.length : firstUnreviewed,
  )
  const [revealed, setRevealed] = useState(false)

  const done = index >= session.items.length || session.items.length === 0
  // After the last item is reviewed the user lands on the Reflection step
  // (DET-196). Finishing reflection ends the session and shows the summary.
  const [reflected, setReflected] = useState(false)

  // End the session on the server, but keep the local `session` prop so the
  // completion summary stays on screen. The active-session cache is only
  // cleared when the user leaves (the empty-state "End session" button), so we
  // don't unmount this component mid-summary.
  const endSession = useMutation({
    mutationFn: () => api.endSession(session.id),
  })

  const leaveSession = () => {
    queryClient.setQueryData(['session', 'active'], null)
  }

  // Empty-state session (zero items): nothing was due. Encourage capture rather
  // than a blank loop.
  if (session.items.length === 0) {
    return (
      <div className='screen'>
        <div className='page-head'>
          <div className='section-label'>§ Recall · The daily loop</div>
          <h1>Session</h1>
        </div>
        {/* One step back in the loop (DET-308): recall practice needs an earned
            concept first, so point at Concepts rather than dead-ending here. The
            "End session" control rides alongside to clear the empty server
            session. */}
        <EmptyState
          message='Nothing is due for review.'
          hint='Recall builds on concepts you’ve earned. Earn one and it resurfaces here when it’s time to recall it.'
          cta={{ href: '/concepts', label: 'Earn a concept first' }}
        >
          <button
            type='button'
            onClick={() =>
              endSession.mutate(undefined, { onSuccess: leaveSession })
            }
            disabled={endSession.isPending}
            className='btn-ghost empty-cta'
          >
            {endSession.isPending ? 'Ending…' : 'End session'}
          </button>
        </EmptyState>
      </div>
    )
  }

  if (done) {
    // The loop is finished. Reflect first (skippable), then show the summary.
    // The session is ended on the server when the user finishes reflecting.
    if (!reflected) {
      return (
        <ReflectionStep
          session={session}
          onFinish={async (items) => {
            if (items.length > 0) {
              await api.submitReflections(session.id, items)
            }
            await endSession.mutateAsync()
            setReflected(true)
          }}
        />
      )
    }
    return <SessionComplete session={session} onLeave={leaveSession} />
  }

  const current = session.items[index]

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>
          § Recall · Concept {index + 1} of {session.items.length}
        </div>
        <h1>Session</h1>
        <p className='lede'>
          Recall it from memory first — then check yourself.
        </p>
      </div>

      {/* Position in the queue — a finishing cue for the daily loop (DET-241). */}
      <div
        className='session-progressbar'
        role='progressbar'
        aria-valuenow={index}
        aria-valuemax={session.items.length}
      >
        <span
          className='session-progressbar-fill'
          style={{ width: `${(index / session.items.length) * 100}%` }}
        />
      </div>

      <SessionCard
        key={current.id}
        item={current}
        revealed={revealed}
        onReveal={() => setRevealed(true)}
        onRated={() => {
          setRevealed(false)
          setIndex((i) => i + 1)
        }}
        sessionId={session.id}
      />
    </div>
  )
}

const RATINGS = [0, 1, 2, 3, 4, 5] as const

function SessionCard({
  item,
  revealed,
  onReveal,
  onRated,
  sessionId,
}: {
  item: SessionItem
  revealed: boolean
  onReveal: () => void
  onRated: () => void
  sessionId: string
}) {
  const [answer, setAnswer] = useState('')

  // The card prompt comes from the user's own compression, never the source.
  const cardsQuery = useQuery({
    queryKey: ['session-cards', item.conceptId],
    queryFn: () => api.getRetrievalCards(item.conceptId),
  })
  // Their latest articulation is the "answer" revealed on demand — their words.
  const conceptQuery = useQuery({
    queryKey: ['session-concept', item.conceptId],
    queryFn: () => api.getConcept(item.conceptId),
    enabled: revealed,
  })

  const review = useMutation({
    mutationFn: (score: number) =>
      api.reviewSessionItem(sessionId, item.conceptId, score),
    onSuccess: onRated,
  })

  // Keyboard rating (DET-241): once revealed, 0–5 rate the recall — the
  // repetitive action in the daily loop — without reaching for the mouse.
  useEffect(() => {
    if (!revealed) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key >= '0' && e.key <= '5' && !review.isPending) {
        review.mutate(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, review])

  const prompt = cardsQuery.data?.[0]?.prompt
  const articulation = conceptQuery.data?.articulations[0]?.body

  return (
    <section className='panel panel-raised session-card'>
      <div className='row-top'>
        <h3 className='panel-h'>{item.title}</h3>
        <span className='chip chip-quiet'>
          {SESSION_ITEM_REASON_LABELS[item.reason]}
        </span>
        {/* Contested (DET-199): mark a contested concept here too, so the signal
            is visible everywhere it surfaces — detail, list, and this view. */}
        {item.cognitiveState === 'CONTESTED' && (
          <span className='chip chip-contested'>Contested</span>
        )}
      </div>

      {item.reason === 'CHALLENGE' && (
        <p className='callout callout-pending' style={{ marginTop: 14 }}>
          You’ve internalized this — the Tutor would push on it. Recall the core
          idea and rate how solid it still feels.
        </p>
      )}

      {cardsQuery.isLoading && <p className='prompt'>Loading the prompt…</p>}
      {prompt ? (
        <p className='prompt'>{prompt}</p>
      ) : (
        !cardsQuery.isLoading && (
          <p className='prompt'>
            Recall what you understand about this concept, in your own words.
          </p>
        )
      )}

      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder='Answer from memory…'
        rows={4}
        disabled={revealed}
        className='fld'
        style={{ marginTop: 18 }}
      />

      {!revealed ? (
        <button
          type='button'
          onClick={onReveal}
          className='btn-ghost'
          style={{ marginTop: 18 }}
        >
          Reveal &amp; rate
        </button>
      ) : (
        <div className='reveal-block'>
          <div className='your-comp'>
            <div className='label'>Your words</div>
            {conceptQuery.isLoading ? (
              <p>Loading…</p>
            ) : articulation ? (
              <p>{articulation}</p>
            ) : (
              <p>No articulation recorded yet.</p>
            )}
          </div>

          <div className='rate'>
            <p className='block-sub' style={{ marginBottom: 10 }}>
              How well did you recall it?
            </p>
            <div className='rate-row'>
              {RATINGS.map((score) => {
                const tone = score <= 1 ? 'low' : score <= 3 ? 'mid' : 'high'
                return (
                  <button
                    key={score}
                    type='button'
                    onClick={() => review.mutate(score)}
                    disabled={review.isPending}
                    className={`rate-btn rate-${tone}`}
                  >
                    {score}
                  </button>
                )
              })}
            </div>
            <p className='rate-hint'>
              0 = blank · 5 = effortless · press <kbd>0</kbd>–<kbd>5</kbd>
            </p>
            {review.isError && (
              <p className='notice notice-error' style={{ marginTop: 10 }}>
                Could not record that. Try again.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// The four reflection prompts (DET-196), in order. Each maps to a ReflectionKind
// whose downstream effect the server applies. Order matters: clearer/less-clear
// first (the most common moves), then the richer connect/challenge prompts.
const REFLECTION_PROMPTS: { kind: ReflectionKind; question: string }[] = [
  { kind: 'CLEARER', question: 'Which concept feels clearer?' },
  { kind: 'LESS_CLEAR', question: 'Which feels less clear?' },
  { kind: 'CONNECTED', question: 'Did anything connect?' },
  { kind: 'CHALLENGE_NEXT', question: 'Anything to challenge next time?' },
]

/**
 * The closing Reflection step (DET-196). Up to four skippable prompts, each
 * letting the user optionally pick one concept from THIS session + a short note.
 * Reflection never blocks closing: skipping every prompt and finishing still
 * ends the session. Kept light (30–90s) — not a journaling form.
 */
function ReflectionStep({
  session,
  onFinish,
}: {
  session: Session
  onFinish: (
    items: { conceptId: string; kind: ReflectionKind; note?: string }[],
  ) => Promise<void>
}) {
  // Per-prompt selection: the chosen concept id (or '' for skipped) + note.
  const [answers, setAnswers] = useState<
    Record<ReflectionKind, { conceptId: string; note: string }>
  >({
    CLEARER: { conceptId: '', note: '' },
    LESS_CLEAR: { conceptId: '', note: '' },
    CONNECTED: { conceptId: '', note: '' },
    CHALLENGE_NEXT: { conceptId: '', note: '' },
  })
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState(false)

  const setAnswer = (
    kind: ReflectionKind,
    patch: Partial<{ conceptId: string; note: string }>,
  ) => setAnswers((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }))

  const finish = async () => {
    const items = REFLECTION_PROMPTS.filter(
      (p) => answers[p.kind].conceptId !== '',
    ).map((p) => ({
      conceptId: answers[p.kind].conceptId,
      kind: p.kind,
      note: answers[p.kind].note.trim() || undefined,
    }))
    setFinishing(true)
    setError(false)
    try {
      await onFinish(items)
    } catch {
      setError(true)
      setFinishing(false)
    }
  }

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Recall · Reflection</div>
        <h1>
          What <em>moved?</em>
        </h1>
        <p className='lede'>
          A quick reflection so this session changes something. Answer what
          fits, skip the rest.
        </p>
      </div>

      <section className='panel panel-raised reflect'>
        {REFLECTION_PROMPTS.map((p) => (
          <div key={p.kind} className='reflect-q'>
            <label htmlFor={`reflect-${p.kind}`}>{p.question}</label>
            <select
              id={`reflect-${p.kind}`}
              value={answers[p.kind].conceptId}
              onChange={(e) => setAnswer(p.kind, { conceptId: e.target.value })}
              className='fld'
            >
              <option value=''>— skip —</option>
              {session.items.map((item) => (
                <option key={item.conceptId} value={item.conceptId}>
                  {item.title}
                </option>
              ))}
            </select>
            {answers[p.kind].conceptId !== '' && (
              <input
                type='text'
                value={answers[p.kind].note}
                onChange={(e) => setAnswer(p.kind, { note: e.target.value })}
                placeholder='Optional note…'
                maxLength={2000}
                className='fld'
              />
            )}
          </div>
        ))}

        <button
          type='button'
          onClick={finish}
          disabled={finishing}
          className='btn-primary'
        >
          {finishing ? 'Finishing…' : 'Finish'} <span className='ar'>→</span>
        </button>
        {error && (
          <p className='notice notice-error'>
            Could not save that. Try finishing again.
          </p>
        )}
      </section>
    </div>
  )
}

function SessionComplete({
  session,
  onLeave,
}: {
  session: Session
  onLeave: () => void
}) {
  const reviewed = session.items.length

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Recall · Complete</div>
        <h1>Session complete</h1>
      </div>
      <section className='panel panel-raised center'>
        <div className='stamp'>
          {reviewed} {reviewed === 1 ? 'concept' : 'concepts'} reviewed
        </div>
        <p
          className='block-sub'
          style={{ maxWidth: 420, margin: '18px auto 0' }}
        >
          You rebuilt these from memory — that’s the work that makes them stick.
        </p>
        <Link
          href='/concepts'
          onClick={onLeave}
          className='btn-ghost'
          style={{ marginTop: 22, alignSelf: 'center' }}
        >
          Back to your concepts
        </Link>
      </section>
    </div>
  )
}
