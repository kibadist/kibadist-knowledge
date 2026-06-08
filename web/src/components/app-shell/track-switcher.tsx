'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useTracks } from '@/lib/tracks-context'

/**
 * The track switcher — the "which track am I focused on" control in the toolbar,
 * mirroring the WorkspaceSwitcher (DET-233). Shows the active track and a
 * dropdown to refocus, plus a link to the Tracks page (where a track is created
 * with its type + goal). Reuses the `ws-*` dropdown styling; light paper theme.
 */
export function TrackSwitcher() {
  const { tracks, activeTrack, setActiveTrack, loading } = useTracks()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // Dismiss on outside click or Escape, like a native menu (same as Workspace).
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

  const label = activeTrack?.name ?? (loading ? 'Loading…' : 'No track')

  return (
    <div className='ws-switch track-switch' ref={ref}>
      <button
        type='button'
        className='ws-switch-btn'
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className='ws-switch-kicker'>Track</span>
        <span className='ws-switch-name'>{label}</span>
        <span className='ws-switch-caret' aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className='ws-menu' role='menu'>
          <div className='ws-menu-head'>Your tracks</div>
          {tracks.length > 0 ? (
            <ul className='ws-menu-list'>
              {tracks.map((track) => {
                const active = track.id === activeTrack?.id
                return (
                  <li key={track.id}>
                    <button
                      type='button'
                      role='menuitemradio'
                      aria-checked={active}
                      className={`ws-menu-item${active ? ' is-active' : ''}`}
                      onClick={() => {
                        setActiveTrack(track.id)
                        close()
                      }}
                    >
                      <span className='ws-menu-check' aria-hidden>
                        {active ? '✓' : ''}
                      </span>
                      <span className='ws-menu-label'>{track.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className='ws-menu-empty'>
              {loading ? 'Loading…' : 'No tracks yet.'}
            </p>
          )}

          <div className='ws-menu-foot'>
            <Link href='/tracks' className='ws-menu-new' onClick={close}>
              {tracks.length > 0 ? 'All tracks →' : '+ Start a track'}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
