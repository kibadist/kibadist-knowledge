'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { CaptureSource } from '@/lib/api'

import { ArticleBody } from './article-body'
import {
  captureSourceLabel,
  hasReadableContent,
  hostLabel,
  type ReaderHeading,
  readableDate,
} from './reader-content'
import { ReaderToc } from './reader-toc'

import './reader.css'

export interface ArticleReaderProps {
  /** Source content: Lexical state JSON, markdown, or plain text. */
  content: string | null | undefined
  /** Title of the source (rendered when `showHeader`). */
  title?: string | null
  /** Origin URL, if captured from the web. */
  sourceUrl?: string | null
  /** How the source was captured. */
  captureSource?: CaptureSource | null
  /** Capture timestamp (ISO). */
  capturedAt?: string | null
  /**
   * `full` is the dedicated reading moment (title, meta, TOC, page-flow).
   * `compact` is a capped, scrollable reference panel for secondary surfaces.
   */
  variant?: 'full' | 'compact'
  /** Show the title + meta header. The provenance eyebrow always shows. */
  showHeader?: boolean
  /** Stable key for per-source scroll restoration (compact variant only). */
  storageKey?: string
}

/**
 * The Reader (DET-209): a calm, legible surface for reading captured/cleaned
 * source material before interrogation, reference Q&A, and compression.
 *
 * It is deliberately NOT an editor and NOT a note. A persistent provenance
 * eyebrow makes the boundary explicit: this is source/reference material, not
 * earned knowledge. Nothing here is canonical until the Proof-of-Learning Gate
 * is passed.
 */
export function ArticleReader({
  content,
  title,
  sourceUrl,
  captureSource,
  capturedAt,
  variant = 'full',
  showHeader = true,
  storageKey,
}: ArticleReaderProps) {
  const [headings, setHeadings] = useState<ReaderHeading[]>([])
  const onHeadings = useCallback((next: ReaderHeading[]) => {
    setHeadings(next)
  }, [])

  if (!hasReadableContent(content)) {
    return <ReaderEmpty />
  }

  const sourceLabel = captureSourceLabel(captureSource)
  const host = hostLabel(sourceUrl)
  const date = readableDate(capturedAt)
  const hasMeta = Boolean(sourceLabel || host || date)
  const isCompact = variant === 'compact'

  return (
    <article
      className={`kb-reader ${isCompact ? 'kb-reader--compact' : 'kb-reader--full'}`}
    >
      <p className='kb-reader-eyebrow'>
        <span className='kb-reader-eyebrow-dot' aria-hidden='true' />
        Source · cleaned for reading
      </p>

      {showHeader && (title || hasMeta) && (
        <header className='kb-reader-header'>
          {title && <h2 className='kb-reader-title'>{title}</h2>}
          {hasMeta && (
            <p className='kb-reader-meta'>
              {sourceLabel && <span>{sourceLabel}</span>}
              {host && (
                <a
                  href={sourceUrl ?? undefined}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='kb-reader-meta-link'
                >
                  {host}
                </a>
              )}
              {date && <span>{date}</span>}
            </p>
          )}
        </header>
      )}

      {!isCompact && headings.length >= 2 && <ReaderToc headings={headings} />}

      <ReaderScroll storageKey={isCompact ? storageKey : undefined}>
        <ArticleBody
          content={content}
          onHeadings={isCompact ? undefined : onHeadings}
        />
      </ReaderScroll>

      <p className='kb-reader-footnote'>
        Reference material — not your knowledge yet. You’ll articulate it in
        your own words at the gate.
      </p>
    </article>
  )
}

/**
 * Wraps the reading body. In the compact variant this is the capped, scrollable
 * container; when given a `storageKey` it preserves the reader's scroll position
 * per source across remounts (session-scoped).
 */
function ReaderScroll({
  storageKey,
  children,
}: {
  storageKey?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!storageKey) return
    const el = ref.current
    if (!el) return
    const key = `kb-reader-scroll:${storageKey}`

    const saved = Number(window.sessionStorage.getItem(key))
    if (saved > 0) el.scrollTop = saved

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        window.sessionStorage.setItem(key, String(el.scrollTop))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [storageKey])

  return (
    <div ref={ref} className='kb-reader-scroll'>
      {children}
    </div>
  )
}

/** Empty state when a source has no readable text yet. */
export function ReaderEmpty() {
  return (
    <div className='kb-reader kb-reader--state'>
      <p className='kb-reader-eyebrow'>
        <span className='kb-reader-eyebrow-dot' aria-hidden='true' />
        Source · cleaned for reading
      </p>
      <p className='kb-reader-state-text'>
        No readable text was captured for this source.
      </p>
    </div>
  )
}

/** Loading placeholder mirroring the reading column's rhythm. */
export function ReaderSkeleton() {
  return (
    <div className='kb-reader kb-reader--state' aria-hidden='true'>
      <p className='kb-reader-eyebrow'>
        <span className='kb-reader-eyebrow-dot' aria-hidden='true' />
        Source · cleaned for reading
      </p>
      <div className='kb-reader-skeleton'>
        <span className='kb-reader-skeleton-line' style={{ width: '60%' }} />
        <span className='kb-reader-skeleton-line' style={{ width: '95%' }} />
        <span className='kb-reader-skeleton-line' style={{ width: '88%' }} />
        <span className='kb-reader-skeleton-line' style={{ width: '92%' }} />
        <span className='kb-reader-skeleton-line' style={{ width: '40%' }} />
      </div>
    </div>
  )
}

/** Error state for a source that failed to load. */
export function ReaderError({
  message,
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <div className='kb-reader kb-reader--state kb-reader--error'>
      <p className='kb-reader-state-text'>
        {message ?? 'Could not load this source.'}
      </p>
      {onRetry && (
        <button type='button' onClick={onRetry} className='kb-reader-retry'>
          Try again
        </button>
      )}
    </div>
  )
}
