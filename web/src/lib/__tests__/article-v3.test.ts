import { describe, expect, it } from 'vitest'

import {
  isScaffold,
  objectiveSectionIds,
  sourceKindLabel,
  v3StatusLabel,
} from '../article-v3'

describe('article-v3 helpers (DET-343)', () => {
  it('identifies scaffold provenance', () => {
    expect(isScaffold('scaffold')).toBe(true)
    expect(isScaffold('source')).toBe(false)
  })

  it('labels every source kind', () => {
    expect(sourceKindLabel('transcript')).toBe('Transcript lesson')
    expect(sourceKindLabel('structured_article')).toBe('Structured article')
    expect(sourceKindLabel('reference')).toBe('Reference')
    expect(sourceKindLabel('mixed')).toBe('Mixed source')
  })

  it('labels every v3 status', () => {
    expect(v3StatusLabel('READY_FOR_REVIEW')).toBe('Ready for review')
    expect(v3StatusLabel('NEEDS_REGENERATION')).toBe('Needs regeneration')
    expect(v3StatusLabel('BLOCKED')).toBe('Blocked')
    expect(v3StatusLabel('FAILED')).toBe('Failed')
  })

  it('de-duplicates objective section ids', () => {
    expect(
      objectiveSectionIds({
        id: 'lp-0',
        objective: 'x',
        sectionIds: ['sec-0', 'sec-0', 'sec-1'],
      }),
    ).toEqual(['sec-0', 'sec-1'])
  })
})
