'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { InboxProgressGlyph } from '@/components/inbox/progress-glyph'
import { OnboardingPanel } from '@/components/onboarding/onboarding-panel'
import { api } from '@/lib/api'
import { lengthLabel, sourceMark } from '@/lib/inbox-format'
import { deriveTrackProgress, dueReasonSummary } from '@/lib/today'
import { useTracks } from '@/lib/tracks-context'

/**
 * Today (DET-302) — the post-login home and the answer to the returning user's
 * only question: "what should I do right now?". Three stacked panels walk the
 * core loop in order — recall what's fading, read what's waiting, keep the
 * active track moving — each linking into its own surface. No streaks: "due"
 * counts only. Everything here is read live; nothing is stored on this screen.
 */
export default function TodayPage() {
  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Today · Your loop</div>
        <h1>Today</h1>
        <p className='lede'>
          One question: what should you do right now? Recall what’s fading, read
          what’s waiting, and keep your active track moving.
        </p>
      </div>

      {/* First-run walkthrough (DET-307): renders only for a brand-new workspace
          or an in-progress walkthrough; silent once dismissed/complete. */}
      <OnboardingPanel />

      <div className='today-panels'>
        <DuePanel />
        <ReadPanel />
        <TrackPanel />
      </div>
    </div>
  )
}

/**
 * Due for recall — the daily Session entry point, the habit that makes
 * everything durable. Count + reasons from the retrieval queue; "Start session"
 * is always reachable so the loop never dead-ends.
 */
function DuePanel() {
  const dueQuery = useQuery({
    queryKey: ['due-retrievals'],
    queryFn: api.getDueRetrievals,
  })
  const due = dueQuery.data ?? []
  const summary = dueReasonSummary(due)

  return (
    <section className='panel panel-raised today-panel'>
      <div className='today-panel-head'>
        <span className='section-label'>§ Recall · Due now</span>
        {summary && <span className='head-count'>{summary}</span>}
      </div>
      <h2 className='today-panel-title'>Due for recall</h2>

      {dueQuery.isLoading && <p className='block-sub'>Loading…</p>}
      {dueQuery.isError && (
        <p className='today-empty'>Could not load what’s due.</p>
      )}

      {!dueQuery.isLoading && !dueQuery.isError && due.length === 0 ? (
        <p className='today-empty'>
          Nothing’s due right now. Earned concepts resurface here when it’s time
          to recall them — a quiet day is fine.
        </p>
      ) : (
        due.length > 0 && (
          <ul className='today-list'>
            {due.slice(0, 4).map((d) => (
              <li key={d.id} className='today-due-row'>
                <Link href={`/concepts/${d.id}`} className='today-due-title'>
                  {d.title}
                </Link>
                {d.cognitiveState === 'CONTESTED' && (
                  <span className='chip chip-contested'>Contested</span>
                )}
              </li>
            ))}
          </ul>
        )
      )}

      <Link href='/session' className='btn-primary today-cta'>
        Start session <span className='ar'>→</span>
      </Link>
    </section>
  )
}

/**
 * Waiting to be read — the top of the reading queue (the inbox triage data),
 * each row carrying a source + read-time signal. A finished article reads
 * directly; an in-flight one routes to its triage row. Links into Read.
 */
function ReadPanel() {
  const inboxQuery = useQuery({ queryKey: ['inbox'], queryFn: api.listInbox })
  const items = inboxQuery.data ?? []

  return (
    <section className='panel panel-raised today-panel'>
      <div className='today-panel-head'>
        <span className='section-label'>§ Read · Waiting</span>
        {items.length > 0 && (
          <span className='head-count'>{items.length} waiting</span>
        )}
      </div>
      <h2 className='today-panel-title'>Waiting to be read</h2>

      {inboxQuery.isLoading && <p className='block-sub'>Loading…</p>}
      {inboxQuery.isError && (
        <p className='today-empty'>Could not load your reading queue.</p>
      )}

      {!inboxQuery.isLoading && !inboxQuery.isError && items.length === 0 ? (
        <p className='today-empty'>
          Your reading queue is clear. Add a source and it’ll show up here.
        </p>
      ) : (
        items.length > 0 && (
          <ul className='today-list'>
            {items.slice(0, 4).map((item) => {
              // One destination (DET-313): every row opens the document workspace,
              // which picks Source vs Article by readiness itself.
              const articleReady =
                item.latestArticleId !== null &&
                item.latestArticleStatus === 'FINAL'
              const len = lengthLabel(item.wordCount)
              return (
                <li key={item.id} className='today-read-row'>
                  <Link href={`/read/${item.id}`} className='today-read-main'>
                    <span className='today-read-source'>
                      {sourceMark(item)}
                    </span>
                    <span className='today-read-title'>{item.title}</span>
                  </Link>
                  <span className='today-read-meta'>
                    {len && <span className='today-read-len'>{len}</span>}
                    {/* Same read → recalled → kept glyph as the inbox (DET-316). */}
                    <InboxProgressGlyph learning={item.learning} />
                    {articleReady && (
                      <span className='chip chip-cleared'>Ready</span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )
      )}

      <Link href='/inbox' className='today-more'>
        Go to Read <span className='ar'>→</span>
      </Link>
    </section>
  )
}

// Human labels for the goal kinds, kept on the client so the editorial copy
// reads naturally (the enum values are the wire format). Mirrors the tracks page.
const TRACK_TYPE_LABELS: Record<string, string> = {
  LEARNING: 'Learning',
  RESEARCH: 'Research',
  PROJECT: 'Project',
  CAREER: 'Career',
  COURSE: 'Course',
  PAPER_REVIEW: 'Paper review',
  PRODUCT_BUILDING: 'Product building',
}

/**
 * Active track — the primary ACTIVE track with its live derived-progress bar
 * (the same derivation the Tracks list uses). Tracks live on Today as the
 * organizing widget; their full pages stay reachable from here.
 */
function TrackPanel() {
  // The toolbar's focused track drives this panel (the provider falls back to
  // the first ACTIVE track when nothing is chosen), so Today and the switcher
  // always agree on which track is in view.
  const { activeTrack: active, loading: tracksLoading } = useTracks()

  const conceptsQuery = useQuery({
    queryKey: ['track-concepts', active?.id],
    queryFn: () => api.listTrackConcepts(active!.id),
    enabled: !!active,
  })
  const { total, met, pct } = deriveTrackProgress(conceptsQuery.data ?? [])

  return (
    <section className='panel panel-raised today-panel'>
      <div className='today-panel-head'>
        <span className='section-label'>§ Track · In progress</span>
        <Link href='/tracks' className='today-more'>
          All tracks <span className='ar'>→</span>
        </Link>
      </div>
      <h2 className='today-panel-title'>Active track</h2>

      {tracksLoading && <p className='block-sub'>Loading…</p>}

      {!tracksLoading && !active ? (
        <div className='today-track-empty'>
          <p className='today-empty'>
            No active track. Name what you’re trying to understand and the loop
            has a destination.
          </p>
          <Link href='/tracks' className='btn-primary today-cta'>
            Start a track <span className='ar'>→</span>
          </Link>
        </div>
      ) : (
        active && (
          <Link href={`/tracks/${active.id}`} className='today-track-card'>
            <div className='today-track-top'>
              <span className='today-track-name'>{active.name}</span>
              <span className='chip chip-quiet'>
                {TRACK_TYPE_LABELS[active.type] ?? active.type}
              </span>
            </div>
            {active.goal && <p className='track-goal'>{active.goal}</p>}
            <div className='track-progress'>
              <div className='track-progress-bar'>
                <span
                  className={`track-progress-fill${
                    pct === 100 ? ' is-complete' : ''
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className='track-progress-label'>
                {total === 0
                  ? 'No concepts yet'
                  : `${pct}% · ${met} / ${total} at depth`}
              </span>
            </div>
          </Link>
        )
      )}
    </section>
  )
}
