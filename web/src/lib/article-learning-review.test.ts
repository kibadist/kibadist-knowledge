import { describe, expect, it } from 'vitest'

import type { LearningLayer } from './api'
import {
  ARTICLE_JSON_V3,
  type ConceptCandidateV3,
  groupCandidatesByImportance,
  groupPromptsByType,
  isInternalized,
  learningLayerToReviewV3,
  promptAllowsScheduling,
  type RetrievalPromptV3,
} from './article-learning-review'

/**
 * DET-359 v3 review contract. These are the pure helpers + the server-layer
 * adapter: grouping by importance / type, the scheduling gate, the
 * no-internalization invariant, and the graceful defaults the adapter applies to
 * learning-layer rows generated before the v3 fields existed.
 */

function candidate(over: Partial<ConceptCandidateV3> = {}): ConceptCandidateV3 {
  return {
    id: 'c1',
    label: 'A concept',
    importance: 'medium',
    definition: 'A definition.',
    sourceBlockIds: ['b1'],
    status: 'pending',
    ...over,
  }
}

function prompt(over: Partial<RetrievalPromptV3> = {}): RetrievalPromptV3 {
  return {
    id: 'p1',
    prompt: 'What is X?',
    type: 'recall',
    linkedConceptIds: [],
    expectedAnswerBlockIds: ['b1'],
    status: 'suggested',
    sourceBlockIds: ['b1'],
    ...over,
  }
}

describe('groupCandidatesByImportance', () => {
  it('orders High → Medium → Low and omits empty buckets', () => {
    const groups = groupCandidatesByImportance([
      candidate({ id: 'a', importance: 'low' }),
      candidate({ id: 'b', importance: 'high' }),
      candidate({ id: 'c', importance: 'high' }),
    ])
    expect(groups.map((g) => g.importance)).toEqual(['high', 'low'])
    expect(groups[0].candidates.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('preserves input order within a bucket', () => {
    const groups = groupCandidatesByImportance([
      candidate({ id: 'x', importance: 'medium' }),
      candidate({ id: 'y', importance: 'medium' }),
    ])
    expect(groups[0].candidates.map((c) => c.id)).toEqual(['x', 'y'])
  })
})

describe('groupPromptsByType', () => {
  it('groups by type in stable order, omitting empty groups', () => {
    const groups = groupPromptsByType([
      prompt({ id: 'a', type: 'application' }),
      prompt({ id: 'b', type: 'recall' }),
    ])
    expect(groups.map((g) => g.type)).toEqual(['recall', 'application'])
  })
})

describe('promptAllowsScheduling', () => {
  it('is true only for an answered prompt with a non-empty answer', () => {
    expect(
      promptAllowsScheduling(
        prompt({ status: 'answered', userAnswer: 'my words' }),
      ),
    ).toBe(true)
  })

  it('is false when merely saved (no answer authored)', () => {
    expect(promptAllowsScheduling(prompt({ status: 'saved' }))).toBe(false)
  })

  it('is false for an answered prompt with a blank answer', () => {
    expect(
      promptAllowsScheduling(prompt({ status: 'answered', userAnswer: '   ' })),
    ).toBe(false)
  })
})

describe('isInternalized', () => {
  it('is always false — accepting never internalizes knowledge', () => {
    expect(isInternalized(candidate({ status: 'accepted' }))).toBe(false)
  })
})

describe('learningLayerToReviewV3', () => {
  it('returns empty arrays for a null layer (drives empty states)', () => {
    const review = learningLayerToReviewV3(null)
    expect(review.schema_version).toBe(ARTICLE_JSON_V3)
    expect(review.conceptCandidates).toEqual([])
    expect(review.retrievalPrompts).toEqual([])
  })

  it('maps validation status onto the review status', () => {
    const layer: LearningLayer = {
      concepts: [],
      retrievalPrompts: [],
      conceptCandidates: [
        {
          id: 'cc1',
          sectionId: 's1',
          label: 'L',
          definition: 'D',
          sourceBlockIds: ['b1'],
          aiAssisted: true,
          validationStatus: 'validated',
        },
        {
          id: 'cc2',
          sectionId: 's1',
          label: 'L2',
          definition: 'D2',
          sourceBlockIds: ['b2'],
          aiAssisted: true,
          validationStatus: 'dismissed',
        },
      ],
    }
    const review = learningLayerToReviewV3(layer)
    expect(review.conceptCandidates.map((c) => c.status)).toEqual([
      'accepted',
      'rejected',
    ])
  })

  it('defaults v3-only fields on legacy rows', () => {
    const layer: LearningLayer = {
      concepts: [],
      retrievalPrompts: [
        { id: 'p1', prompt: 'Q?', sourceBlockIds: ['b1', 'b2'] },
      ],
      conceptCandidates: [
        {
          id: 'cc1',
          sectionId: 's1',
          label: 'L',
          definition: 'D',
          sourceBlockIds: ['b1'],
          aiAssisted: true,
          validationStatus: 'pending',
        },
      ],
    }
    const review = learningLayerToReviewV3(layer)
    expect(review.conceptCandidates[0].importance).toBe('medium')
    const p = review.retrievalPrompts[0]
    expect(p.type).toBe('recall')
    expect(p.status).toBe('suggested')
    expect(p.linkedConceptIds).toEqual([])
    // Expected-answer blocks fall back to the prompt's own source blocks.
    expect(p.expectedAnswerBlockIds).toEqual(['b1', 'b2'])
  })

  it('preserves explicit v3 fields when present', () => {
    const layer: LearningLayer = {
      concepts: [],
      retrievalPrompts: [
        {
          id: 'p1',
          prompt: 'Q?',
          sourceBlockIds: ['b1'],
          promptType: 'application',
          linkedConceptIds: ['cc1'],
          expectedAnswerBlockIds: ['b9'],
          reviewStatus: 'answered',
          userAnswer: 'mine',
        },
      ],
      conceptCandidates: [
        {
          id: 'cc1',
          sectionId: 's1',
          label: 'L',
          definition: 'D',
          sourceBlockIds: ['b1'],
          aiAssisted: true,
          validationStatus: 'pending',
          importance: 'high',
          sourceSpanPreview: 'a span',
        },
      ],
    }
    const review = learningLayerToReviewV3(layer)
    expect(review.conceptCandidates[0].importance).toBe('high')
    expect(review.conceptCandidates[0].sourceSpanPreview).toBe('a span')
    const p = review.retrievalPrompts[0]
    expect(p.type).toBe('application')
    expect(p.linkedConceptIds).toEqual(['cc1'])
    expect(p.expectedAnswerBlockIds).toEqual(['b9'])
    expect(promptAllowsScheduling(p)).toBe(true)
  })
})
