import { describe, expect, it } from 'vitest'

import type { DueConcept, Track, TrackConceptRow } from '@/lib/api'
import { deriveTrackProgress, dueReasonSummary, pickActiveTrack } from './today'

// Minimal fixtures: only the fields the derivations read. Cast through unknown so
// the tests don't have to spell out the full wire shapes (mirrors the api types).
function due(
  id: string,
  cognitiveState: DueConcept['cognitiveState'],
): DueConcept {
  return { id, title: id, cognitiveState, nextReviewAt: null }
}

function trackConcept(met: boolean): TrackConceptRow {
  return { progress: { met } } as unknown as TrackConceptRow
}

function track(id: string, status: Track['status']): Track {
  return { id, status } as unknown as Track
}

describe('deriveTrackProgress', () => {
  it('is all-zero for an empty track (no divide-by-zero)', () => {
    expect(deriveTrackProgress([])).toEqual({ total: 0, met: 0, pct: 0 })
  })

  it('counts concepts meeting their depth and rounds the percentage', () => {
    const rows = [trackConcept(true), trackConcept(true), trackConcept(false)]
    // 2 of 3 = 66.67 → 67
    expect(deriveTrackProgress(rows)).toEqual({ total: 3, met: 2, pct: 67 })
  })

  it('reports 100% when every concept is at depth', () => {
    expect(deriveTrackProgress([trackConcept(true)])).toEqual({
      total: 1,
      met: 1,
      pct: 100,
    })
  })
})

describe('pickActiveTrack', () => {
  it('returns null when nothing is active', () => {
    expect(pickActiveTrack([])).toBeNull()
    expect(pickActiveTrack([track('a', 'PAUSED')])).toBeNull()
  })

  it('returns the first ACTIVE track, skipping non-active ones', () => {
    const tracks = [
      track('paused', 'PAUSED'),
      track('first', 'ACTIVE'),
      track('second', 'ACTIVE'),
    ]
    expect(pickActiveTrack(tracks)?.id).toBe('first')
  })
})

describe('dueReasonSummary', () => {
  it('is empty when nothing is due', () => {
    expect(dueReasonSummary([])).toBe('')
  })

  it('reads as a plain due count with no contested items', () => {
    expect(dueReasonSummary([due('a', 'RETRIEVED'), due('b', 'DORMANT')])).toBe(
      '2 due',
    )
  })

  it('appends the contested count when some are contested', () => {
    const items = [
      due('a', 'RETRIEVED'),
      due('b', 'CONTESTED'),
      due('c', 'DORMANT'),
    ]
    expect(dueReasonSummary(items)).toBe('3 due · 1 contested')
  })
})
