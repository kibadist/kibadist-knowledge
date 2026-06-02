'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { ConceptGraphCanvas } from '@/components/graph/concept-graph-canvas'
import {
  api,
  type ImportanceLevel,
  type RequiredDepth,
  type TrackConceptRow,
  type TrackConceptStatus,
  type TrackStatus,
} from '@/lib/api'
import { useWorkspace } from '@/lib/workspace-context'

const DEPTH_LABELS: Record<RequiredDepth, string> = {
  RECOGNIZE: 'Recognize',
  EXPLAIN: 'Explain',
  APPLY: 'Apply',
  TEACH: 'Teach',
}
const IMPORTANCE_LABELS: Record<ImportanceLevel, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
}
const TC_STATUS_LABELS: Record<TrackConceptStatus, string> = {
  CANDIDATE: 'Candidate',
  ACCEPTED: 'Accepted',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
}
const TRACK_STATUS_OPTIONS: TrackStatus[] = [
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
]

/**
 * Track detail (DET-237): the track's concepts as an ordered, editable plan —
 * importance, required depth, and per-concept status (candidate → accepted →
 * completed) — plus the TRACK-scoped graph (DET-236) embedded as a view. All
 * presentation: required depth is the track's demand, never a change to the
 * concept's actual cognitive state or a shortcut through the gate.
 */
export default function TrackDetailPage() {
  const params = useParams<{ id: string }>()
  const trackId = params.id
  const router = useRouter()
  const queryClient = useQueryClient()
  const { activeWorkspaceId } = useWorkspace()

  // The track itself is read from the list cache (DET-235 exposes no single-track
  // GET; the list is cheap and already cached from the tracks index).
  const tracksQuery = useQuery({
    queryKey: ['tracks', activeWorkspaceId],
    queryFn: () => api.listTracks(),
  })
  const track = tracksQuery.data?.find((t) => t.id === trackId)

  const conceptsQuery = useQuery({
    queryKey: ['track-concepts', trackId],
    queryFn: () => api.listTrackConcepts(trackId),
  })
  const rows = useMemo(() => conceptsQuery.data ?? [], [conceptsQuery.data])

  // TRACK-scoped graph (DET-236): the same canvas, fed a different subset.
  const graphQuery = useQuery({
    queryKey: ['graph', 'track', trackId],
    queryFn: () => api.getScopedGraph({ scope: 'TRACK', trackId }),
  })

  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['track-concepts', trackId] })
    queryClient.invalidateQueries({ queryKey: ['graph', 'track', trackId] })
  }

  const setTrackStatus = useMutation({
    mutationFn: (status: TrackStatus) => api.updateTrack(trackId, { status }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['tracks', activeWorkspaceId],
      }),
  })

  const deleteTrack = useMutation({
    mutationFn: () => api.deleteTrack(trackId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracks', activeWorkspaceId] })
      router.push('/tracks')
    },
  })

  if (tracksQuery.isLoading) {
    return (
      <div className='screen'>
        <p className='notice'>Loading track…</p>
      </div>
    )
  }
  if (!track) {
    return (
      <div className='screen'>
        <div className='page-head'>
          <Link href='/tracks' className='back-link'>
            ← Tracks
          </Link>
          <h1>Track not found</h1>
        </div>
        <p className='notice'>
          This track doesn’t exist in the current workspace.
        </p>
      </div>
    )
  }

  const hasNodes = (graphQuery.data?.nodes.length ?? 0) > 0

  return (
    <div className='screen'>
      <div className='page-head'>
        <Link href='/tracks' className='back-link'>
          ← Tracks
        </Link>
        <div className='section-label'>§ Track · {track.type}</div>
        <h1>{track.name}</h1>
        {track.goal && <p className='lede'>{track.goal}</p>}
        <div className='track-detail-controls'>
          <label className='inline-field'>
            <span>Status</span>
            <select
              className='fld fld-sm'
              value={track.status}
              onChange={(e) =>
                setTrackStatus.mutate(e.target.value as TrackStatus)
              }
            >
              {TRACK_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <button
            type='button'
            className='btn-ghost-sm danger'
            onClick={() => {
              if (
                window.confirm(
                  'Delete this track? Its concepts stay — only the track and its plan are removed.',
                )
              ) {
                deleteTrack.mutate()
              }
            }}
          >
            Delete track
          </button>
        </div>
      </div>

      <section className='track-section'>
        <h2 className='track-group-head'>Concepts</h2>
        <AddConceptControl
          trackId={trackId}
          rows={rows}
          onChanged={invalidate}
        />

        {conceptsQuery.isLoading && <p className='notice'>Loading concepts…</p>}
        {!conceptsQuery.isLoading && rows.length === 0 && (
          <div className='empty'>
            No concepts in this track yet.
            <span>
              Add an earned concept above, or import a source to start this
              track (capture it in your <Link href='/inbox'>inbox</Link>, then
              promote it).
            </span>
          </div>
        )}

        {rows.length > 0 && (
          <ul className='track-concept-list'>
            {rows.map((row, index) => (
              <TrackConceptRowView
                key={row.conceptId}
                trackId={trackId}
                row={row}
                index={index}
                count={rows.length}
                rows={rows}
                onChanged={invalidate}
              />
            ))}
          </ul>
        )}
      </section>

      <section className='track-section'>
        <h2 className='track-group-head'>Track map</h2>
        <p className='track-section-note'>
          The TRACK-scoped slice of your concept graph — the same canvas, just
          this track’s concepts and the links between them.
        </p>
        {graphQuery.isLoading && <p className='notice'>Loading the map…</p>}
        {!graphQuery.isLoading && !hasNodes && (
          <div className='empty'>
            Nothing to map yet.
            <span>Add concepts to this track to see them connected.</span>
          </div>
        )}
        {hasNodes && graphQuery.data && (
          <div className='track-graph-frame'>
            <ConceptGraphCanvas
              data={graphQuery.data}
              selectedId={selectedNode}
              onSelect={setSelectedNode}
            />
          </div>
        )}
      </section>
    </div>
  )
}

/** One concept in the track plan: depth/importance/status controls + reorder. */
function TrackConceptRowView({
  trackId,
  row,
  index,
  count,
  rows,
  onChanged,
}: {
  trackId: string
  row: TrackConceptRow
  index: number
  count: number
  rows: TrackConceptRow[]
  onChanged: () => void
}) {
  const update = useMutation({
    mutationFn: (input: {
      status?: TrackConceptStatus
      importance?: ImportanceLevel
      requiredDepth?: RequiredDepth
      orderIndex?: number
    }) => api.updateTrackConcept(trackId, row.conceptId, input),
    onSuccess: onChanged,
  })
  const remove = useMutation({
    mutationFn: () => api.removeTrackConcept(trackId, row.conceptId),
    onSuccess: onChanged,
  })

  // Reorder by swapping this row's orderIndex with its neighbour's display
  // position. Both rows are renumbered to their array positions so the order is
  // stable even when some rows still have a null orderIndex.
  const move = useMutation({
    mutationFn: async (dir: -1 | 1) => {
      const target = index + dir
      if (target < 0 || target >= count) return
      const other = rows[target]
      await Promise.all([
        api.updateTrackConcept(trackId, row.conceptId, { orderIndex: target }),
        api.updateTrackConcept(trackId, other.conceptId, { orderIndex: index }),
      ])
    },
    onSuccess: onChanged,
  })

  const { progress, concept } = row
  const stateClass = progress.met
    ? 'met'
    : progress.needsAttention
      ? 'attention'
      : 'pending'

  return (
    <li className={`track-concept-row ${stateClass}`}>
      <div className='track-concept-order'>
        <button
          type='button'
          className='ord-btn'
          aria-label='Move up'
          disabled={index === 0 || move.isPending}
          onClick={() => move.mutate(-1)}
        >
          ↑
        </button>
        <button
          type='button'
          className='ord-btn'
          aria-label='Move down'
          disabled={index === count - 1 || move.isPending}
          onClick={() => move.mutate(1)}
        >
          ↓
        </button>
      </div>

      <div className='track-concept-main'>
        <Link href={`/concepts/${concept.id}`} className='track-concept-title'>
          {concept.title}
        </Link>
        <div className='track-concept-meta'>
          <span
            className={`chip chip-depth${progress.met ? ' is-met' : ''}`}
            title={`Now at ${progress.state}`}
          >
            {progress.met ? '✓ ' : ''}
            {DEPTH_LABELS[row.requiredDepth]}
          </span>
          {progress.needsAttention && (
            <span className='chip chip-warn'>
              {progress.state.toLowerCase()}
            </span>
          )}
          <span className='track-concept-statelabel'>
            now: {concept.cognitiveState.toLowerCase()}
          </span>
        </div>
      </div>

      <div className='track-concept-controls'>
        <select
          className='fld fld-sm'
          value={row.requiredDepth}
          aria-label='Required depth'
          onChange={(e) =>
            update.mutate({ requiredDepth: e.target.value as RequiredDepth })
          }
        >
          {Object.entries(DEPTH_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          className='fld fld-sm'
          value={row.importance}
          aria-label='Importance'
          onChange={(e) =>
            update.mutate({ importance: e.target.value as ImportanceLevel })
          }
        >
          {Object.entries(IMPORTANCE_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          className='fld fld-sm'
          value={row.status}
          aria-label='Status'
          onChange={(e) =>
            update.mutate({ status: e.target.value as TrackConceptStatus })
          }
        >
          {Object.entries(TC_STATUS_LABELS).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button
          type='button'
          className='btn-ghost-xs'
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

/** Pick an earned concept not already in the track and add it. */
function AddConceptControl({
  trackId,
  rows,
  onChanged,
}: {
  trackId: string
  rows: TrackConceptRow[]
  onChanged: () => void
}) {
  const [conceptId, setConceptId] = useState('')
  const conceptsQuery = useQuery({
    queryKey: ['concepts'],
    queryFn: api.listConcepts,
  })
  const inTrack = new Set(rows.map((r) => r.conceptId))
  const available = (conceptsQuery.data ?? []).filter((c) => !inTrack.has(c.id))

  const add = useMutation({
    mutationFn: () => api.addTrackConcept(trackId, { conceptId }),
    onSuccess: () => {
      setConceptId('')
      onChanged()
    },
  })

  if (conceptsQuery.isLoading) return null
  if (available.length === 0) {
    return (
      <p className='track-section-note'>
        {rows.length > 0
          ? 'All your concepts are already in this track.'
          : 'No earned concepts yet to add — promote something from your inbox first.'}
      </p>
    )
  }

  return (
    <div className='track-add-row'>
      <select
        className='fld'
        value={conceptId}
        onChange={(e) => setConceptId(e.target.value)}
      >
        <option value=''>Add a concept…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <button
        type='button'
        className='btn-primary'
        disabled={!conceptId || add.isPending}
        onClick={() => add.mutate()}
      >
        {add.isPending ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}
