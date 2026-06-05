'use client'

import { useCallback, useMemo, useState } from 'react'

import type { LearningAffordance } from './article-v2'

/**
 * Article learning events — the shared event contract (DET-278).
 *
 * Per the coordination ticket, learning events live in their own domain
 * (`article_learning_events`), *outside* the article JSON and *outside* the
 * Concept Library. They are user-activity records: a rewrite is not a concept,
 * a prediction is not a note. Downstream systems (Concept Library, Retrieval
 * Engine, Living Concepts) consume selected events but do not own them.
 *
 * DET-284 scope: Deep Reading Mode is the reading hub, not an exercise. It does
 * not yet persist events to a backend table (that table is owned by the
 * exercise-mode tickets). Instead it *prepares for* the contract: it emits
 * fully-typed events through an `onEmit` sink and tracks per-section action
 * state locally so completion markers can reflect them. Wiring `onEmit` to a
 * POST /article-learning-events endpoint is a drop-in later.
 */

/** Verbatim from DET-278's shared event-to-mode mapping. */
export type ArticleLearningEventType =
  | 'overview_viewed'
  | 'prediction_submitted'
  | 'section_revealed'
  | 'block_rewrite_started'
  | 'block_rewrite_submitted'
  | 'rewrite_peeked'
  | 'comparison_generated'
  | 'rewrite_revised'
  | 'concept_candidate_approved'
  | 'review_prompt_approved'
  | 'review_completed'

/** Source-provenance confidence for a feedback claim (DET-278 §5). */
export type SourceConfidence =
  | 'source_supported'
  | 'article_supported_source_unavailable'
  | 'user_authored_unsourced'
  | 'unsupported_or_invented'
  | 'needs_review'

/** Lifecycle of a generated review prompt (DET-278 §4). */
export type ReviewPromptStatus =
  | 'suggested'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'retired'

/** Structured AI feedback (stored as data, never only prose — DET-278 §2/§5). */
export interface ArticleLearningFeedback {
  summary?: string
  preserved?: string[]
  missing?: string[]
  changed_meaning?: string[]
  unsupported?: string[]
  source_confidence?: SourceConfidence
}

export interface ArticleLearningEvent {
  id: string
  user_id?: string
  article_id: string
  article_version_id?: string
  section_id?: string
  block_id?: string
  source_span_ids?: string[]

  event_type: ArticleLearningEventType

  /** The prompt the user responded to, when applicable. */
  prompt?: string
  /** User text, stored exactly as written (DET-278: never paraphrase). */
  user_answer?: string
  ai_feedback?: ArticleLearningFeedback

  /** `peek_count`, focus duration, revision history, etc. */
  metadata?: Record<string, unknown>

  created_at: string
  updated_at: string
}

/** A draft event — the caller supplies intent; the store stamps ids/timestamps. */
export type ArticleLearningEventDraft = Omit<
  ArticleLearningEvent,
  'id' | 'created_at' | 'updated_at'
>

/**
 * Which completion an event proves for a section. Drives the reading-surface
 * completion markers. Mirrors the DET-278 event→mode mapping.
 */
export const EVENT_COMPLETION: Partial<
  Record<ArticleLearningEventType, LearningAffordance>
> = {
  prediction_submitted: 'predict',
  block_rewrite_submitted: 'rewrite',
  comparison_generated: 'compare',
  rewrite_revised: 'compare',
  concept_candidate_approved: 'extract_concepts',
  review_completed: 'review',
}

export interface SectionProgress {
  /** Affordances the user has completed in this section. */
  completed: Set<LearningAffordance>
  /** True once the section's prose has been revealed/read. */
  revealed: boolean
}

export interface ArticleLearningState {
  /** All events emitted this session, newest last. */
  events: ArticleLearningEvent[]
  /** Per-section progress derived from `events`. */
  progressBySection: Map<string, SectionProgress>
  /** Emit a typed event (stamps id + timestamps, mirrors to `onEmit`). */
  emit: (draft: ArticleLearningEventDraft) => ArticleLearningEvent
  /** Convenience: has the user completed this affordance in this section? */
  hasCompleted: (sectionId: string, affordance: LearningAffordance) => boolean
}

/** Deterministic-ish id without Date.now/Math.random in module scope. */
let eventSeq = 0
function nextEventId(): string {
  eventSeq += 1
  return `ale_${eventSeq.toString(36)}_${eventSeq}`
}

export interface UseArticleLearningStateOptions {
  /**
   * Sink for emitted events. In MVP this is where a future
   * `POST /article-learning-events` call lives. Defaults to a no-op.
   */
  onEmit?: (event: ArticleLearningEvent) => void
  /** Seed events (e.g. previously stored activity for this article version). */
  initialEvents?: ArticleLearningEvent[]
}

/**
 * Client-side learning-event store for a single article render. It keeps the
 * verbatim contract intact while remaining backend-agnostic, so Deep Reading
 * Mode can light up completion markers today and the exercise tickets can wire
 * persistence without changing the call sites.
 */
export function useArticleLearningState(
  options: UseArticleLearningStateOptions = {},
): ArticleLearningState {
  const { onEmit, initialEvents } = options
  const [events, setEvents] = useState<ArticleLearningEvent[]>(
    () => initialEvents ?? [],
  )

  const emit = useCallback(
    (draft: ArticleLearningEventDraft): ArticleLearningEvent => {
      // `new Date()` is fine here: this runs in an event handler in the browser,
      // not in module/render scope.
      const now = new Date().toISOString()
      const event: ArticleLearningEvent = {
        ...draft,
        id: nextEventId(),
        created_at: now,
        updated_at: now,
      }
      setEvents((prev) => [...prev, event])
      onEmit?.(event)
      return event
    },
    [onEmit],
  )

  const progressBySection = useMemo(() => {
    const map = new Map<string, SectionProgress>()
    const ensure = (sectionId: string): SectionProgress => {
      let entry = map.get(sectionId)
      if (!entry) {
        entry = { completed: new Set(), revealed: false }
        map.set(sectionId, entry)
      }
      return entry
    }
    for (const event of events) {
      if (!event.section_id) continue
      const entry = ensure(event.section_id)
      if (
        event.event_type === 'section_revealed' ||
        event.event_type === 'overview_viewed'
      ) {
        entry.revealed = true
      }
      const affordance = EVENT_COMPLETION[event.event_type]
      if (affordance) entry.completed.add(affordance)
    }
    return map
  }, [events])

  const hasCompleted = useCallback(
    (sectionId: string, affordance: LearningAffordance) =>
      progressBySection.get(sectionId)?.completed.has(affordance) ?? false,
    [progressBySection],
  )

  return { events, progressBySection, emit, hasCompleted }
}
