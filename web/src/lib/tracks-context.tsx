'use client'

import { useQuery } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { api, type Track } from './api'
import { useAuth } from './auth-context'
import { pickActiveTrack } from './today'
import { useWorkspace } from './workspace-context'

interface TracksContextValue {
  /** The active workspace's tracks (newest-status-first as the API returns). */
  tracks: Track[]
  /** The track currently in focus, or null until the list resolves / none exist. */
  activeTrack: Track | null
  activeTrackId: string | null
  loading: boolean
  /** Focus a track (persisted per workspace); presentation state only. */
  setActiveTrack: (id: string) => void
}

const TracksContext = createContext<TracksContextValue | null>(null)

// The chosen track is remembered per workspace — switching worlds keeps each
// world's focus. Presentation/session state only; never affects what is earned.
const trackKey = (workspaceId: string) => `kibadist_active_track:${workspaceId}`

function getStoredTrackId(workspaceId: string): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(trackKey(workspaceId))
}
function setStoredTrackId(workspaceId: string, id: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(trackKey(workspaceId), id)
}

/**
 * Active-track state for the app shell — the toolbar "which track am I focused
 * on" control, mirroring the WorkspaceProvider (DET-233). Loads the active
 * workspace's tracks (sharing the Today panel's ['tracks', workspaceId] cache),
 * remembers the chosen one in localStorage scoped per workspace, and falls back
 * to the first ACTIVE track when nothing is stored. Mounts inside
 * WorkspaceProvider so the list is always scoped to the world in view.
 */
export function TracksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { activeWorkspaceId } = useWorkspace()
  const [activeId, setActiveId] = useState<string | null>(null)

  const tracksQuery = useQuery({
    // Same key as the Today track panel so the two share one fetch + cache.
    queryKey: ['tracks', activeWorkspaceId],
    queryFn: () => api.listTracks(),
    enabled: !!user,
  })
  const tracks = useMemo(() => tracksQuery.data ?? [], [tracksQuery.data])

  // Resolve a valid focused track once the list loads: keep the stored choice if
  // it still exists in this workspace, otherwise fall back to the first ACTIVE
  // track (or none). Re-runs on workspace switch as the scoped list refetches.
  useEffect(() => {
    if (!activeWorkspaceId || tracks.length === 0) {
      setActiveId(null)
      return
    }
    const stored = getStoredTrackId(activeWorkspaceId)
    const resolved =
      stored && tracks.some((t) => t.id === stored)
        ? stored
        : (pickActiveTrack(tracks)?.id ?? null)
    setActiveId(resolved)
  }, [tracks, activeWorkspaceId])

  const setActiveTrack = useCallback(
    (id: string) => {
      if (!activeWorkspaceId) return
      setStoredTrackId(activeWorkspaceId, id)
      setActiveId(id)
    },
    [activeWorkspaceId],
  )

  const activeTrack = useMemo(
    () => tracks.find((t) => t.id === activeId) ?? null,
    [tracks, activeId],
  )

  const value = useMemo<TracksContextValue>(
    () => ({
      tracks,
      activeTrack,
      activeTrackId: activeId,
      loading: tracksQuery.isLoading,
      setActiveTrack,
    }),
    [tracks, activeTrack, activeId, tracksQuery.isLoading, setActiveTrack],
  )

  return (
    <TracksContext.Provider value={value}>{children}</TracksContext.Provider>
  )
}

export function useTracks(): TracksContextValue {
  const ctx = useContext(TracksContext)
  if (!ctx) {
    throw new Error('useTracks must be used within a TracksProvider')
  }
  return ctx
}
