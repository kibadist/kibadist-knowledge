import { ARTICLE_LEARNING_EVENT_TYPES } from './article-learning.types'
import {
  EVENTS_BY_MODE,
  eventsForMode,
  isEventAllowedForMode,
  modesForEvent,
} from './event-mode-map'

describe('EVENTS_BY_MODE — matches the DET-278 mapping', () => {
  it('maps each mode to its exact event set', () => {
    expect(eventsForMode('DET-280')).toEqual(['overview_viewed'])
    expect(eventsForMode('DET-282')).toEqual([
      'prediction_submitted',
      'section_revealed',
      'comparison_generated',
    ])
    expect(eventsForMode('DET-285')).toEqual([
      'block_rewrite_started',
      'rewrite_peeked',
      'block_rewrite_submitted',
    ])
    expect(eventsForMode('DET-286')).toEqual([
      'comparison_generated',
      'rewrite_revised',
    ])
    expect(eventsForMode('DET-287')).toEqual(['concept_candidate_approved'])
    expect(eventsForMode('DET-288')).toEqual([
      'review_prompt_approved',
      'review_completed',
    ])
  })

  it('only references event types from the canonical union', () => {
    const valid = new Set<string>(ARTICLE_LEARNING_EVENT_TYPES)
    for (const events of Object.values(EVENTS_BY_MODE)) {
      for (const event of events) {
        expect(valid.has(event)).toBe(true)
      }
    }
  })

  it('is frozen (read-only at runtime)', () => {
    expect(Object.isFrozen(EVENTS_BY_MODE)).toBe(true)
  })
})

describe('modesForEvent', () => {
  it('returns the single owner for a mode-specific event', () => {
    expect(modesForEvent('overview_viewed')).toEqual(['DET-280'])
  })

  it('returns every mode for a shared event', () => {
    expect(modesForEvent('comparison_generated').sort()).toEqual([
      'DET-282',
      'DET-286',
    ])
  })

  it('every canonical event is emitted by at least one mode', () => {
    for (const event of ARTICLE_LEARNING_EVENT_TYPES) {
      expect(modesForEvent(event).length).toBeGreaterThan(0)
    }
  })
})

describe('isEventAllowedForMode', () => {
  it('accepts an event the mode owns', () => {
    expect(isEventAllowedForMode('DET-285', 'rewrite_peeked')).toBe(true)
  })

  it('rejects an event from another mode', () => {
    expect(isEventAllowedForMode('DET-285', 'overview_viewed')).toBe(false)
  })
})
