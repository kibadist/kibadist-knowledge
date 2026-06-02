'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'

import { api, type Track, type TrackStatus, type TrackType } from '@/lib/api'
import { useWorkspace } from '@/lib/workspace-context'

// Human labels for the goal kinds + lifecycle, kept on the client so the
// editorial copy reads naturally (the enum values are the wire format).
const TRACK_TYPE_LABELS: Record<TrackType, string> = {
  LEARNING: 'Learning',
  RESEARCH: 'Research',
  PROJECT: 'Project',
  CAREER: 'Career',
  COURSE: 'Course',
  PAPER_REVIEW: 'Paper review',
  PRODUCT_BUILDING: 'Product building',
}

// The lifecycle order tracks are grouped by on the list (active work first).
const STATUS_ORDER: TrackStatus[] = [
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
]
const STATUS_LABELS: Record<TrackStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
}

/**
 * Tracks — the goal-directed layer and the product's primary entry point
 * (DET-237). You learn with intent ("understand X", "prepare for Y"), so this is
 * the home screen: a list of tracks grouped by lifecycle, each showing its type
 * and derived progress. Pure presentation over the DET-235 endpoints — progress
 * is derived live from each concept's cognitive state, never a stored score.
 */
export default function TracksPage() {
  const { activeWorkspaceId } = useWorkspace()
  const tracksQuery = useQuery({
    // Scope the cache to the active workspace so switching worlds swaps the list.
    queryKey: ['tracks', activeWorkspaceId],
    queryFn: () => api.listTracks(),
  })

  const tracks = tracksQuery.data ?? []
  const byStatus = STATUS_ORDER.map((status) => ({
    status,
    items: tracks.filter((t) => t.status === status),
  })).filter((group) => group.items.length > 0)

  return (
    <div className='screen'>
      <div className='page-head'>
        <div className='section-label'>§ Tracks · Intent</div>
        <h1>Tracks</h1>
        <p className='lede'>
          What you’re trying to understand. Each track sets its own required
          depth for a concept — the same idea can be shallow in one and deep in
          another. Progress is read live from how well you actually know each
          concept.
        </p>
      </div>

      <NewTrackForm />

      {tracksQuery.isLoading && <p className='notice'>Loading tracks…</p>}
      {tracksQuery.isError && (
        <p className='notice notice-error'>Could not load your tracks.</p>
      )}

      {!tracksQuery.isLoading && tracks.length === 0 && (
        <div className='empty'>
          No tracks yet.
          <span>
            Start one above — name what you want to understand, then add
            concepts to it.
          </span>
        </div>
      )}

      {byStatus.map((group) => (
        <section key={group.status} className='track-group'>
          <h2 className='track-group-head'>{STATUS_LABELS[group.status]}</h2>
          <ul className='rows'>
            {group.items.map((track) => (
              <TrackCard key={track.id} track={track} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** One track row with a live derived-progress bar (concepts meeting their depth). */
function TrackCard({ track }: { track: Track }) {
  // Per-track concepts drive the progress bar. React Query caches/dedupes this,
  // so opening the detail view reuses the same data.
  const conceptsQuery = useQuery({
    queryKey: ['track-concepts', track.id],
    queryFn: () => api.listTrackConcepts(track.id),
  })
  const rows = conceptsQuery.data ?? []
  const total = rows.length
  const met = rows.filter((r) => r.progress.met).length
  const pct = total === 0 ? 0 : Math.round((met / total) * 100)

  return (
    <li className='track-card'>
      <Link href={`/tracks/${track.id}`} className='track-card-main'>
        <div className='track-card-top'>
          <span className='track-name'>{track.name}</span>
          <span className='chip chip-quiet'>
            {TRACK_TYPE_LABELS[track.type]}
          </span>
        </div>
        {track.goal && <p className='track-goal'>{track.goal}</p>}
        <div className='track-progress'>
          <div className='track-progress-bar'>
            <span
              className='track-progress-fill'
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className='track-progress-label'>
            {total === 0
              ? 'No concepts yet'
              : `${met} / ${total} at required depth`}
          </span>
        </div>
      </Link>
    </li>
  )
}

/** Inline "new track" form with a goal-type picker (editorial paper styling). */
function NewTrackForm() {
  const queryClient = useQueryClient()
  const { activeWorkspaceId } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<TrackType>('LEARNING')
  const [goal, setGoal] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.createTrack({
        name: name.trim(),
        type,
        goal: goal.trim() || undefined,
      }),
    onSuccess: () => {
      setName('')
      setGoal('')
      setType('LEARNING')
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['tracks', activeWorkspaceId] })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || create.isPending) return
    create.mutate()
  }

  if (!open) {
    return (
      <button
        type='button'
        className='btn-primary track-new-btn'
        onClick={() => setOpen(true)}
      >
        + New track
      </button>
    )
  }

  return (
    <form className='track-new-form' onSubmit={submit}>
      <input
        // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
        autoFocus
        className='fld'
        placeholder='What do you want to understand?'
        value={name}
        maxLength={160}
        onChange={(e) => setName(e.target.value)}
      />
      <div className='track-new-row'>
        <select
          className='fld'
          value={type}
          onChange={(e) => setType(e.target.value as TrackType)}
        >
          {Object.entries(TRACK_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className='fld'
          placeholder='Goal (optional) — e.g. ship the feature'
          value={goal}
          maxLength={2000}
          onChange={(e) => setGoal(e.target.value)}
        />
      </div>
      <div className='track-new-actions'>
        <button
          type='submit'
          className='btn-primary'
          disabled={!name.trim() || create.isPending}
        >
          {create.isPending ? 'Creating…' : 'Create track'}
        </button>
        <button
          type='button'
          className='btn-ghost-sm'
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
      {create.isError && (
        <p className='notice notice-error'>Could not create the track.</p>
      )}
    </form>
  )
}
