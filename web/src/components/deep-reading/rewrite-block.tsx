'use client'

import { useCallback, useId, useRef, useState } from 'react'

import type { ArticleSectionV2, ArticleV2 } from '@/lib/article-v2'
import {
  REWRITE_PROMPT,
  type RewritableBlock,
  type RewriteMetrics,
  rewriteBlockNoun,
  rewriteOrientation,
  rewriteWordCount,
} from '@/lib/rewrite-block'

import { DeepReadingBlock } from './deep-reading-block'

/**
 * Rewrite-the-Block — one block (DET-285).
 *
 * The learner reconstructs a single source block from memory. The mechanics the
 * ticket pins down all live here:
 *  - The source block blurs the moment the editor takes focus, so the learner
 *    can't copy or lightly paraphrase the visible text. Blur lifts when the
 *    editor loses focus — unless the learner turns on "locked focus", which keeps
 *    the block blurred until they explicitly peek.
 *  - Copy/paste off the blurred source is suppressed: no copy control is shown,
 *    text selection is disabled, and the copy/cut/context events are cancelled
 *    while blurred (CSS in deep-reading.css enforces `user-select: none`).
 *  - Peeking is deliberate and tracked. A "Peek" toggle temporarily reveals the
 *    source; every reveal increments `peek_count`, and the first one records
 *    `time_before_first_peek_ms`.
 *  - Lifecycle events flow to the parent so they emit through the one shared
 *    learning store: `block_rewrite_started` on first focus, `rewrite_peeked`
 *    on each peek, `block_rewrite_submitted` on submit (with the verbatim
 *    rewrite, the source snapshot, and the metrics).
 *
 * Submitting hands off to Compare & Repair (DET-286): the rewrite is stored as
 * user activity, the source is revealed for a manual side-by-side, and nothing
 * here is promoted to a note or concept (DET-278).
 */
export interface RewriteBlockProps {
  article: ArticleV2
  section: ArticleSectionV2
  block: RewritableBlock
  /** 1-based position among the section's rewritable blocks. */
  index: number
  total: number
  /** Whether this block's rewrite has already been submitted this session. */
  submitted: boolean
  /** First editor focus — parent emits `block_rewrite_started`. */
  onStart: (block: RewritableBlock) => void
  /** Each explicit peek — parent emits `rewrite_peeked`. */
  onPeek: (block: RewritableBlock, peekIndex: number) => void
  /** Submit — parent emits `block_rewrite_submitted` with text + metrics. */
  onSubmit: (
    block: RewritableBlock,
    rewrite: string,
    metrics: RewriteMetrics,
  ) => void
  /** Whether to scroll this card into view on mount (entry focus target). */
  autoFocus?: boolean
}

export function RewriteBlock({
  article: _article,
  section: _section,
  block,
  index,
  total,
  submitted,
  onStart,
  onPeek,
  onSubmit,
  autoFocus,
}: RewriteBlockProps) {
  const fieldId = useId()
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [lockedFocus, setLockedFocus] = useState(false)
  const [peeking, setPeeking] = useState(false)
  const [done, setDone] = useState(submitted)

  // Activity tracking — kept in refs so it survives re-renders without churn.
  // `performance.now()` is fine in handlers (never in render/module scope).
  const startedRef = useRef(false)
  const peekCountRef = useRef(0)
  const firstFocusAtRef = useRef<number | null>(null)
  const firstPeekAtRef = useRef<number | null>(null)
  const focusAccumRef = useRef(0)
  const focusEnteredAtRef = useRef<number | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)

  const setRef = useCallback(
    (el: HTMLElement | null) => {
      sectionRef.current = el
      if (el && autoFocus) {
        const reduceMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
        el.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        })
      }
    },
    [autoFocus],
  )

  // The source is hidden whenever the editor is engaged (focused, or locked) and
  // the learner isn't actively peeking. Once submitted it's always revealed so
  // the learner can self-compare before Compare & Repair.
  const blurred = !done && (focused || lockedFocus) && !peeking

  const handleFocus = useCallback(() => {
    setFocused(true)
    focusEnteredAtRef.current = performance.now()
    if (firstFocusAtRef.current === null) {
      firstFocusAtRef.current = focusEnteredAtRef.current
    }
    if (!startedRef.current) {
      startedRef.current = true
      onStart(block)
    }
  }, [block, onStart])

  const handleBlur = useCallback(() => {
    setFocused(false)
    if (focusEnteredAtRef.current !== null) {
      focusAccumRef.current += performance.now() - focusEnteredAtRef.current
      focusEnteredAtRef.current = null
    }
  }, [])

  const togglePeek = useCallback(() => {
    setPeeking((cur) => {
      const next = !cur
      if (next) {
        peekCountRef.current += 1
        const now = performance.now()
        if (firstPeekAtRef.current === null) firstPeekAtRef.current = now
        onPeek(block, peekCountRef.current)
      }
      return next
    })
  }, [block, onPeek])

  const handleSubmit = useCallback(() => {
    const text = draft.trim()
    if (!text || done) return
    // Fold any in-progress focus interval into the accumulated duration.
    let focusMs = focusAccumRef.current
    if (focusEnteredAtRef.current !== null) {
      focusMs += performance.now() - focusEnteredAtRef.current
      focusEnteredAtRef.current = null
    }
    const timeBeforeFirstPeek =
      firstPeekAtRef.current !== null && firstFocusAtRef.current !== null
        ? Math.max(
            0,
            Math.round(firstPeekAtRef.current - firstFocusAtRef.current),
          )
        : null
    const metrics: RewriteMetrics = {
      peek_count: peekCountRef.current,
      editor_focus_duration_ms: Math.round(focusMs),
      time_before_first_peek_ms: timeBeforeFirstPeek,
      word_count: rewriteWordCount(text),
    }
    setDone(true)
    setFocused(false)
    setPeeking(false)
    onSubmit(block, text, metrics)
  }, [block, draft, done, onSubmit])

  // Block copy/cut off the blurred source so the learner can't lift the text.
  const suppressCopy = useCallback(
    (e: React.ClipboardEvent | React.SyntheticEvent) => {
      if (blurred) e.preventDefault()
    },
    [blurred],
  )

  const noun = rewriteBlockNoun(block)
  const orientation = rewriteOrientation(block, index, total)
  const words = rewriteWordCount(draft)

  return (
    <section
      ref={setRef}
      className={`kb-rw-block${done ? ' is-submitted' : ''}`}
      aria-label={`Rewrite ${noun}`}
    >
      <header className='kb-rw-block-head'>
        <span className='kb-rw-block-num'>
          {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
        <span className='kb-rw-block-noun'>{noun}</span>
        {done && (
          <span className='kb-rw-block-badge' aria-hidden='true'>
            ✓ rewritten
          </span>
        )}
      </header>

      <p className='kb-rw-orient'>{orientation}</p>

      {/* The source block. Blurred while the editor is engaged; copy suppressed
          throughout so the text can't be lifted off the page. */}
      <div
        className={`kb-rw-source${blurred ? ' is-blurred' : ''}`}
        // `inert` while blurred keeps focus/AT out of the obscured prose so no
        // caret or screen reader lands on text the learner is meant to recall.
        inert={blurred ? true : undefined}
        aria-hidden={blurred ? true : undefined}
        onCopy={suppressCopy}
        onCut={suppressCopy}
        onContextMenu={suppressCopy}
      >
        <div className='kb-reader-content kb-dr-prose'>
          <DeepReadingBlock block={block} />
        </div>
      </div>

      {blurred && (
        <div className='kb-rw-veil'>
          <span className='kb-rw-veil-text' aria-hidden='true'>
            Source hidden — write from memory
          </span>
          <button
            type='button'
            className='kb-rw-peek'
            // `onMouseDown`/`preventDefault` keeps editor focus while peeking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={togglePeek}
            aria-label='Peek at the hidden source (tracked)'
          >
            Peek{peekCountRef.current > 0 ? ` · ${peekCountRef.current}` : ''}
          </button>
        </div>
      )}

      {!done && (
        <div className='kb-rw-editor'>
          <label className='kb-rw-prompt' htmlFor={fieldId}>
            {REWRITE_PROMPT}
          </label>
          <textarea
            id={fieldId}
            className='kb-rw-input'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder='Explain this block in your own words…'
            rows={5}
            // Submit on Cmd/Ctrl+Enter; plain Enter keeps making paragraphs.
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit()
            }}
          />

          <div className='kb-rw-controls'>
            <div className='kb-rw-toggles'>
              {peeking && (
                <button
                  type='button'
                  className='kb-rw-peek is-active'
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={togglePeek}
                >
                  Hide source
                </button>
              )}
              <label className='kb-rw-lock'>
                <input
                  type='checkbox'
                  checked={lockedFocus}
                  onChange={(e) => setLockedFocus(e.target.checked)}
                />
                Locked focus
                <span className='kb-rw-lock-hint'>
                  keep blurred when I look away
                </span>
              </label>
            </div>

            <div className='kb-rw-submit-row'>
              <span className='kb-rw-words' aria-live='polite'>
                {words} word{words === 1 ? '' : 's'}
              </span>
              <button
                type='button'
                className='kb-rw-submit'
                onClick={handleSubmit}
                disabled={draft.trim().length === 0}
              >
                Submit for comparison
              </button>
            </div>
          </div>
          <p className='kb-rw-hint'>
            Meaning over wording — shorter is fine if it holds. Your rewrite is
            saved as activity for Compare &amp; Repair, never as a note.
          </p>
        </div>
      )}

      {done && (
        <div className='kb-rw-submitted'>
          <p className='kb-rw-submitted-eyebrow'>Your rewrite</p>
          <blockquote className='kb-rw-submitted-text'>{draft}</blockquote>
          <p className='kb-rw-submitted-foot'>
            Saved for Compare &amp; Repair. The source is shown above so you can
            check it yourself — nothing here becomes a note or concept yet.
          </p>
        </div>
      )}
    </section>
  )
}
