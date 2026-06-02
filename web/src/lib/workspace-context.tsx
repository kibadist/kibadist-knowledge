'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  api,
  clearActiveWorkspaceId,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  type Workspace,
} from './api'
import { useAuth } from './auth-context'

interface WorkspaceContextValue {
  /** The user's workspaces, oldest first (the first is their default). */
  workspaces: Workspace[]
  /** The workspace currently in view, or null until the list resolves. */
  activeWorkspace: Workspace | null
  activeWorkspaceId: string | null
  loading: boolean
  /** Switch the active workspace and drop the previous world's cached data. */
  switchWorkspace: (id: string) => void
  /** Create a workspace and select into it (empty). */
  createWorkspace: (name: string) => Promise<Workspace>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

/**
 * Active-workspace state for the app shell (DET-233) — the client half of the
 * DET-232 tenancy. Loads the user's workspaces, remembers the chosen one in
 * localStorage (read by the api.ts fetch wrappers to stamp `X-Workspace-Id`),
 * and on switch/create resets the scoped React Query caches so data from the
 * previous world never bleeds across. Mounts inside AuthProvider so it only
 * loads once a user is established. Presentation/session state only — switching
 * changes *what you see*, never *what is earned*.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const queryClient = useQueryClient()
  // Start null (no localStorage read during SSR/first paint); the effect below
  // resolves it from storage once the list is known, avoiding hydration drift.
  const [activeId, setActiveId] = useState<string | null>(null)

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.listWorkspaces(),
    enabled: !!user,
  })
  const workspaces = useMemo(
    () => workspacesQuery.data ?? [],
    [workspacesQuery.data],
  )

  // Resolve a valid active workspace once the list loads: keep the stored choice
  // if it still exists, otherwise fall back to the user's default (earliest).
  useEffect(() => {
    if (workspaces.length === 0) return
    const stored = getActiveWorkspaceId()
    const resolved =
      stored && workspaces.some((w) => w.id === stored)
        ? stored
        : workspaces[0].id
    if (resolved !== stored) setActiveWorkspaceId(resolved)
    setActiveId((prev) => (prev === resolved ? prev : resolved))
  }, [workspaces])

  // On a genuine logout, forget the active workspace so a different account
  // signing in on this browser never inherits — or sends as X-Workspace-Id —
  // the prior world. Gated on `!authLoading` so the brief `user === null` during
  // the initial auth check doesn't wipe the persisted choice on every reload.
  useEffect(() => {
    if (!authLoading && !user) {
      clearActiveWorkspaceId()
      setActiveId(null)
    }
  }, [user, authLoading])

  // Drop cached data from the previous world; active observers refetch with the
  // new header. The workspace list is preserved so the switcher doesn't flicker.
  const resetScopedQueries = useCallback(() => {
    queryClient.resetQueries({
      predicate: (q) => q.queryKey[0] !== 'workspaces',
    })
  }, [queryClient])

  const switchWorkspace = useCallback(
    (id: string) => {
      if (id === getActiveWorkspaceId()) return
      setActiveWorkspaceId(id)
      setActiveId(id)
      resetScopedQueries()
    },
    [resetScopedQueries],
  )

  const createWorkspace = useCallback(
    async (name: string) => {
      const ws = await api.createWorkspace({ name })
      await queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      setActiveWorkspaceId(ws.id)
      setActiveId(ws.id)
      resetScopedQueries()
      return ws
    },
    [queryClient, resetScopedQueries],
  )

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  )

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspace,
      activeWorkspaceId: activeId,
      loading: workspacesQuery.isLoading,
      switchWorkspace,
      createWorkspace,
    }),
    [
      workspaces,
      activeWorkspace,
      activeId,
      workspacesQuery.isLoading,
      switchWorkspace,
      createWorkspace,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return ctx
}
