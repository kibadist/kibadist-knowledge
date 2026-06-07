// Pure derivations for the Today home (DET-302). Kept out of the page component
// so the loop's logic — which track is "primary", what the due-recall summary
// reads, how a track's progress is computed — is unit-testable without React,
// TanStack Query, or the network. The Today panels and the Tracks list both read
// progress through deriveTrackProgress so the bar means the same thing in both.
import type { DueConcept, Track, TrackConceptRow } from '@/lib/api'

export interface TrackProgress {
  total: number
  met: number
  pct: number
}

/**
 * A track's live progress: how many of its concepts currently meet their
 * required depth. Never a stored score — `progress.met` is derived server-side
 * from each concept's cognitive state against the track's required depth.
 */
export function deriveTrackProgress(rows: TrackConceptRow[]): TrackProgress {
  const total = rows.length
  const met = rows.filter((r) => r.progress.met).length
  const pct = total === 0 ? 0 : Math.round((met / total) * 100)
  return { total, met, pct }
}

/**
 * The primary ACTIVE track shown on Today — the first active one the API
 * returns (tracks come back active-work-first). Null when nothing is active, so
 * the panel can fall back to a "start a track" prompt.
 */
export function pickActiveTrack(tracks: Track[]): Track | null {
  return tracks.find((t) => t.status === 'ACTIVE') ?? null
}

/**
 * The one-line reason summary beside "Due for recall" — e.g. "3 due · 1
 * contested". Empty string when nothing is due (the panel shows its rest state
 * instead). "due" counts only; no streak mechanics (DET-302 acceptance).
 */
export function dueReasonSummary(due: DueConcept[]): string {
  const total = due.length
  if (total === 0) return ''
  const contested = due.filter((d) => d.cognitiveState === 'CONTESTED').length
  const parts = [`${total} due`]
  if (contested > 0) parts.push(`${contested} contested`)
  return parts.join(' · ')
}
