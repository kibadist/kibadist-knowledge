'use client'

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { useWorkspace } from '@/lib/workspace-context'

/**
 * The workspace switcher (DET-233) — the "which world am I in" control at the
 * top of the nav. Shows the active workspace and a dropdown to switch between
 * worlds or create a new one. Editorial paper styling (`.kbapp`), no dark mode.
 * Switching/creating is handled by the WorkspaceProvider, which resets the
 * scoped query caches so no stale data bleeds across worlds.
 */
export function WorkspaceSwitcher() {
  const {
    workspaces,
    activeWorkspace,
    switchWorkspace,
    createWorkspace,
    loading,
  } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setCreating(false)
    setName('')
  }, [])

  // Dismiss on outside click or Escape, like a native menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await createWorkspace(trimmed)
      close()
    } finally {
      setBusy(false)
    }
  }

  const label = activeWorkspace?.name ?? (loading ? 'Loading…' : 'Workspace')

  return (
    <div className='ws-switch' ref={ref}>
      <button
        type='button'
        className='ws-switch-btn'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className='ws-switch-kicker'>Workspace</span>
        <span className='ws-switch-name'>{label}</span>
        <span className='ws-switch-caret' aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className='ws-menu' role='menu'>
          <div className='ws-menu-head'>Your workspaces</div>
          <ul className='ws-menu-list'>
            {workspaces.map((ws) => {
              const active = ws.id === activeWorkspace?.id
              return (
                <li key={ws.id}>
                  <button
                    type='button'
                    role='menuitemradio'
                    aria-checked={active}
                    className={`ws-menu-item${active ? ' is-active' : ''}`}
                    onClick={() => {
                      switchWorkspace(ws.id)
                      close()
                    }}
                  >
                    <span className='ws-menu-check' aria-hidden>
                      {active ? '✓' : ''}
                    </span>
                    <span className='ws-menu-label'>{ws.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className='ws-menu-foot'>
            {creating ? (
              <form className='ws-create' onSubmit={submitCreate}>
                <input
                  // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
                  autoFocus
                  className='fld ws-create-input'
                  placeholder='New workspace name'
                  value={name}
                  maxLength={120}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
                <button
                  type='submit'
                  className='btn-ghost-xs'
                  disabled={busy || !name.trim()}
                >
                  {busy ? 'Creating…' : 'Create'}
                </button>
              </form>
            ) : (
              <button
                type='button'
                className='ws-menu-new'
                onClick={() => setCreating(true)}
              >
                + New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
