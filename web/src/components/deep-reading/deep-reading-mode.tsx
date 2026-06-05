'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  captureSourceLabel,
  hostLabel,
} from '@/components/reader/reader-content'
import {
  type ArticleLearningEvent,
  type ArticleLearningState,
  useArticleLearningState,
} from '@/lib/article-learning-events'
import {
  type ArticleV2,
  type LearningAffordance,
  orderedSections,
} from '@/lib/article-v2'

import { DeepReadingSection } from './deep-reading-section'
import { KeyTermOverview } from './key-term-overview'
import {
  type ArticleProvenance,
  type LearningModeHandlers,
  type ReadingMode,
  type SectionContext,
} from './types'

import '../reader/reader.css'
import './deep-reading.css'

/**
 * Deep Reading Mode (DET-284) — the polished full-article reading surface and
 * the hub that connects passive reading to active learning.
 *
 * Responsibilities:
 *  - Render the generated article (Article JSON v2) in full prose with rich,
 *    typed blocks, reusing the Reader's typography and inline renderer.
 *  - Expose quiet, section-level entry points into the active learning modes.
 *  - Reflect completed learning actions back into the reading surface.
 *  - Switch between Overview and Deep Reading without losing reading position.
 *  - Preserve source provenance affordances from the article view.
 *
 * It deliberately does not implement the exercises themselves — it hands off to
 * the mode handlers (Predict/Rewrite/Compare/Concept Extraction/Review) and
 * tracks `article_learning_events` so the surface stays honest about progress.
 *
 * > Let users read beautifully, but never let reading be the final step.
 */
export interface DeepReadingModeProps {
  article: ArticleV2
  /** Which mode to open in. Defaults to deep reading. */
  initialMode?: ReadingMode
  /** Source provenance carried over from the generated-article view. */
  provenance?: ArticleProvenance
  /** Entry points into the active learning modes (all optional). */
  handlers?: LearningModeHandlers
  /**
   * Bring-your-own learning-event store. When omitted the hub creates its own.
   * Pass a shared store when the downstream exercise modes need to emit
   * completion events that this surface should reflect.
   */
  learningState?: ArticleLearningState
  /** Sink for events when the hub owns the store (prepares for persistence). */
  onEmit?: (event: ArticleLearningEvent) => void
  /** Seed events (e.g. previously stored activity for this article version). */
  initialEvents?: ArticleLearningEvent[]
  /** Highlight key terms inside the prose (a source-safe reading aid). */
  highlightKeyTerms?: boolean
}

const EMPTY_HANDLERS: LearningModeHandlers = {}

export function DeepReadingMode({
  article,
  initialMode = 'deep',
  provenance,
  handlers = EMPTY_HANDLERS,
  learningState,
  onEmit,
  initialEvents,
  highlightKeyTerms = true,
}: DeepReadingModeProps) {
  const sections = useMemo(() => orderedSections(article), [article])

  // Always call the hook; use the external store when one is provided.
  const internalState = useArticleLearningState({ onEmit, initialEvents })
  const learning = learningState ?? internalState

  const [mode, setMode] = useState<ReadingMode>(initialMode)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    sections[0]?.section_id ?? null,
  )

  // Section element registry for active-section tracking + scroll restoration.
  const sectionEls = useRef(new Map<string, HTMLElement>())
  const registerRef = useCallback(
    (sectionId: string, el: HTMLElement | null) => {
      if (el) sectionEls.current.set(sectionId, el)
      else sectionEls.current.delete(sectionId)
    },
    [],
  )

  // When we switch into deep mode we restore the reader to the section (or the
  // specific block) they were last looking at — set in overview, or preserved
  // from the prior scroll. Holds a section_id or a block_id DOM anchor.
  const pendingScroll = useRef<string | null>(null)

  const revealedOnce = useRef(new Set<string>())

  // Emit a structural event once when overview is first shown.
  const overviewEmitted = useRef(false)
  useEffect(() => {
    if (mode !== 'overview' || overviewEmitted.current) return
    overviewEmitted.current = true
    learning.emit({
      article_id: article.article_id,
      article_version_id: article.article_version_id,
      event_type: 'overview_viewed',
      metadata: {
        surface: 'deep_reading_mode',
        mode: 'key_term_overview',
        section_count: article.sections.length,
      },
    })
  }, [mode, article, learning])

  // Track the section currently in view (deep mode only), and record the first
  // reveal of each section as a learning event.
  useEffect(() => {
    if (mode !== 'deep') return
    const els = [...sectionEls.current.values()]
    if (els.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const top = visible[0]?.target
        if (top?.id) {
          setActiveSectionId(top.id)
          if (!revealedOnce.current.has(top.id)) {
            revealedOnce.current.add(top.id)
            learning.emit({
              article_id: article.article_id,
              article_version_id: article.article_version_id,
              section_id: top.id,
              event_type: 'section_revealed',
              metadata: { surface: 'deep_reading_mode' },
            })
          }
        }
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )
    for (const el of els) observer.observe(el)
    return () => observer.disconnect()
  }, [mode, sections, article, learning])

  // After entering deep mode, restore position to the pending/active section.
  useEffect(() => {
    if (mode !== 'deep') return
    const targetId = pendingScroll.current ?? activeSectionId
    pendingScroll.current = null
    if (!targetId) return
    // A section anchor lives in the registry; a block anchor (from an overview
    // key-term jump) is a plain DOM id on the rendered block.
    const el =
      sectionEls.current.get(targetId) ?? document.getElementById(targetId)
    if (!el) return
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    // Defer to let the section list paint first.
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      })
    })
    return () => window.cancelAnimationFrame(id)
    // We intentionally only run this when the mode flips to deep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const completedBySection = useCallback(
    (sectionId: string): Set<LearningAffordance> =>
      learning.progressBySection.get(sectionId)?.completed ?? EMPTY_SET,
    [learning],
  )

  const handleSelectFromOverview = useCallback(
    (sectionId: string, blockId?: string) => {
      // Prefer a block anchor when a key-term jump supplied one, so the reader
      // lands on the exact occurrence; otherwise anchor to the section top.
      pendingScroll.current = blockId ?? sectionId
      setActiveSectionId(sectionId)
      setMode('deep')
    },
    [],
  )

  const handleStartReading = useCallback(() => {
    pendingScroll.current = activeSectionId
    setMode('deep')
  }, [activeSectionId])

  const handleToggle = useCallback(
    (next: ReadingMode) => {
      // Preserve position: keep the active section as the deep-mode anchor.
      if (next === 'deep') pendingScroll.current = activeSectionId
      setMode(next)
    },
    [activeSectionId],
  )

  const onAffordance = useCallback(
    (_affordance: LearningAffordance, _ctx: SectionContext) => {
      // The entry point opens the downstream mode (handler). Completion events
      // are emitted by that mode through the shared learning store, so we don't
      // mark completion here — we only delegate.
    },
    [],
  )

  // Reading progress through the article (by active section position).
  const activeIndex = Math.max(
    0,
    sections.findIndex((s) => s.section_id === activeSectionId),
  )
  const progressPct =
    sections.length > 0 ? ((activeIndex + 1) / sections.length) * 100 : 0
  const engaged = sections.filter(
    (s) =>
      (learning.progressBySection.get(s.section_id)?.completed.size ?? 0) > 0,
  ).length

  const sourceLabel = captureSourceLabel(provenance?.captureSource)
  const host = hostLabel(provenance?.sourceUrl)

  return (
    <article className='kb-dr'>
      <div className='kb-dr-bar'>
        <p className='kb-dr-eyebrow'>
          <span className='kb-dr-eyebrow-dot' aria-hidden='true' />
          Generated article · worked example
        </p>
        <div className='kb-dr-modes' role='tablist' aria-label='Reading mode'>
          <button
            type='button'
            role='tab'
            aria-selected={mode === 'overview'}
            className={`seg${mode === 'overview' ? ' on' : ''}`}
            onClick={() => handleToggle('overview')}
          >
            Overview
          </button>
          <button
            type='button'
            role='tab'
            aria-selected={mode === 'deep'}
            className={`seg${mode === 'deep' ? ' on' : ''}`}
            onClick={() => handleToggle('deep')}
          >
            Deep reading
          </button>
        </div>
      </div>

      <header className='kb-dr-header'>
        <h1 className='kb-dr-title'>{article.title}</h1>
        {(sourceLabel || host || provenance?.sourceAvailable === false) && (
          <p className='kb-dr-meta'>
            {sourceLabel && <span>{sourceLabel}</span>}
            {host && (
              <a
                href={provenance?.sourceUrl ?? undefined}
                target='_blank'
                rel='noopener noreferrer'
                className='kb-dr-meta-link'
              >
                {host}
              </a>
            )}
            <span>
              {provenance?.sourceAvailable === false
                ? 'Source spans unavailable'
                : 'Source-grounded'}
            </span>
          </p>
        )}
      </header>

      <div className='kb-dr-progress' aria-hidden='true'>
        <div className='kb-dr-progress-track'>
          <div
            className='kb-dr-progress-fill'
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className='kb-dr-progress-label'>
          {mode === 'deep'
            ? `Section ${activeIndex + 1} of ${sections.length}`
            : `${sections.length} sections`}
          {engaged > 0 && ` · ${engaged} engaged`}
        </p>
      </div>

      {mode === 'overview' ? (
        <KeyTermOverview
          article={article}
          activeSectionId={activeSectionId}
          completedBySection={completedBySection}
          onSelectSection={handleSelectFromOverview}
          onStartReading={handleStartReading}
        />
      ) : (
        <div className='kb-dr-sections'>
          {sections.map((section, i) => (
            <DeepReadingSection
              key={section.section_id}
              article={article}
              section={section}
              index={i + 1}
              total={sections.length}
              completed={completedBySection(section.section_id)}
              handlers={handlers}
              highlightKeyTerms={highlightKeyTerms}
              onAffordance={onAffordance}
              registerRef={registerRef}
            />
          ))}
        </div>
      )}

      <p className='kb-dr-footnote'>
        This is the worked example — the polished explanation. Later modes fade
        this support and ask you to reconstruct the meaning yourself.
      </p>
    </article>
  )
}

const EMPTY_SET: Set<LearningAffordance> = new Set()
