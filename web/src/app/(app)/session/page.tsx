'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { api, type Session, type SessionItem } from '@/lib/api'

/**
 * Understanding Session (DET-198) — the daily 5–15 minute loop. The system
 * resurfaces earned concepts as questions: for each, you retrieve the answer
 * from memory, then reveal your own compression and self-rate the recall. This
 * is recall practice that builds understanding, not a flashcard grind. (No
 * reflection — that's DET-196.)
 */
export default function SessionPage() {
  const queryClient = useQueryClient()

  const activeQuery = useQuery({
    queryKey: ['session', 'active'],
    queryFn: () => api.getActiveSession(),
  })

  const session = activeQuery.data

  if (activeQuery.isLoading) {
    return <p className='text-neutral-400'>Loading session…</p>
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
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Session</h1>
        <p className='text-sm text-neutral-400'>
          The system resurfaces concepts as questions, so you rebuild
          understanding instead of rereading.
        </p>
      </div>

      <section className='flex flex-col gap-4 rounded-lg border border-neutral-800 p-6'>
        <div>
          <h2 className='font-medium'>How long do you have?</h2>
          <p className='mt-1 text-sm text-neutral-500'>
            We&apos;ll build a queue to fit. Five focused minutes beats an hour
            of rereading.
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          {TARGET_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type='button'
              onClick={() => setTargetMinutes(minutes)}
              aria-pressed={targetMinutes === minutes}
              className={`rounded-md border px-3 py-1.5 text-sm transition ${
                targetMinutes === minutes
                  ? 'border-white bg-white text-black'
                  : 'border-neutral-700 text-neutral-300 hover:bg-neutral-900'
              }`}
            >
              {minutes} min
            </button>
          ))}
        </div>
        <button
          type='button'
          onClick={() => start.mutate()}
          disabled={start.isPending}
          className='self-start rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50'
        >
          {start.isPending ? 'Starting…' : 'Start session'}
        </button>
        {start.isError && (
          <p className='text-sm text-red-400'>
            Could not start a session. Try again.
          </p>
        )}
      </section>
    </div>
  )
}

const REASON_LABELS: Record<SessionItem['reason'], string> = {
  DUE: 'due for review',
  CONTESTED: 'contested — resolve the conflict',
  REDISCOVERY: 'rediscovery',
  CHALLENGE: 'the Tutor will challenge this',
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

  // End the session on the server, but keep the local `session` prop so the
  // completion summary stays on screen. The active-session cache is only
  // cleared when the user leaves (the empty-state "End session" button), so we
  // don't unmount this component mid-summary.
  const endSession = useMutation({
    mutationFn: () => api.endSession(session.id),
  })

  // When the loop finishes, end the session once (idempotent on the server).
  const autoEnded = useRef(false)
  useEffect(() => {
    if (done && session.items.length > 0 && !autoEnded.current) {
      autoEnded.current = true
      endSession.mutate()
    }
  }, [done, session.items.length, endSession])

  const leaveSession = () => {
    queryClient.setQueryData(['session', 'active'], null)
  }

  // Empty-state session (zero items): nothing was due. Encourage capture rather
  // than a blank loop.
  if (session.items.length === 0) {
    return (
      <div className='flex flex-col gap-6'>
        <div>
          <h1 className='text-2xl font-semibold'>Session</h1>
        </div>
        <section className='rounded-lg border border-dashed border-neutral-800 p-8 text-center'>
          <p className='text-neutral-400'>Nothing is due for review.</p>
          <p className='mt-1 text-sm text-neutral-500'>
            Concepts you articulate will resurface here when it&apos;s time to
            recall them.
          </p>
          <div className='mt-4 flex justify-center gap-3'>
            <Link
              href='/inbox'
              className='rounded-md bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-neutral-200'
            >
              Capture something
            </Link>
            <button
              type='button'
              onClick={() =>
                endSession.mutate(undefined, { onSuccess: leaveSession })
              }
              disabled={endSession.isPending}
              className='rounded-md border border-neutral-700 px-4 py-2 text-sm transition hover:bg-neutral-900 disabled:opacity-50'
            >
              {endSession.isPending ? 'Ending…' : 'End session'}
            </button>
          </div>
        </section>
      </div>
    )
  }

  if (done) {
    return <SessionComplete session={session} onLeave={leaveSession} />
  }

  const current = session.items[index]

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Session</h1>
        <p className='text-sm text-neutral-400'>
          Concept {index + 1} of {session.items.length} — recall it from memory
          first, then check yourself.
        </p>
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

  const prompt = cardsQuery.data?.[0]?.prompt
  const articulation = conceptQuery.data?.articulations[0]?.body

  return (
    <section className='flex flex-col gap-4 rounded-lg border border-neutral-800 p-6'>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='font-medium'>{item.title}</h2>
        <span className='rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500'>
          {REASON_LABELS[item.reason]}
        </span>
      </div>

      {item.reason === 'CHALLENGE' && (
        <p className='text-sm text-amber-300/80'>
          You&apos;ve internalized this — the Tutor would push on it. Recall the
          core idea and rate how solid it still feels.
        </p>
      )}

      {cardsQuery.isLoading && (
        <p className='text-sm text-neutral-500'>Loading the prompt…</p>
      )}
      {prompt ? (
        <p className='text-sm font-medium text-neutral-100'>{prompt}</p>
      ) : (
        !cardsQuery.isLoading && (
          <p className='text-sm text-neutral-500'>
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
        className='w-full rounded-md border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-60'
      />

      {!revealed ? (
        <button
          type='button'
          onClick={onReveal}
          className='self-start rounded-md border border-neutral-700 px-3 py-1.5 text-sm transition hover:bg-neutral-900'
        >
          Reveal &amp; rate
        </button>
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='rounded-md border border-neutral-800 bg-neutral-950/50 p-3'>
            <p className='mb-1 text-[10px] uppercase tracking-wide text-neutral-500'>
              Your compression
            </p>
            {conceptQuery.isLoading ? (
              <p className='text-sm text-neutral-500'>Loading…</p>
            ) : articulation ? (
              <p className='whitespace-pre-wrap text-sm text-neutral-100'>
                {articulation}
              </p>
            ) : (
              <p className='text-sm text-neutral-500'>
                No articulation recorded yet.
              </p>
            )}
          </div>

          <div>
            <p className='mb-2 text-sm text-neutral-400'>
              How well did you recall it?
            </p>
            <div className='flex flex-wrap gap-2'>
              {RATINGS.map((score) => (
                <button
                  key={score}
                  type='button'
                  onClick={() => review.mutate(score)}
                  disabled={review.isPending}
                  className='h-10 w-10 rounded-md border border-neutral-700 text-sm transition hover:bg-neutral-900 disabled:opacity-50'
                >
                  {score}
                </button>
              ))}
            </div>
            <p className='mt-1 text-xs text-neutral-600'>
              0 = blank · 5 = effortless
            </p>
            {review.isError && (
              <p className='mt-1 text-sm text-red-400'>
                Could not record that. Try again.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
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
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-semibold'>Session complete</h1>
      </div>
      <section className='flex flex-col gap-4 rounded-lg border border-neutral-800 p-8 text-center'>
        <p className='text-neutral-200'>
          {reviewed} {reviewed === 1 ? 'concept' : 'concepts'} reviewed.
        </p>
        <p className='text-sm text-neutral-500'>
          You rebuilt these from memory — that&apos;s the work that makes them
          stick.
        </p>
        <Link
          href='/concepts'
          onClick={onLeave}
          className='self-center rounded-md bg-white px-4 py-2 font-medium text-black transition hover:bg-neutral-200'
        >
          Back to your concepts
        </Link>
      </section>
    </div>
  )
}
