import {
  ArticleLearningEventType as PrismaArticleLearningEventType,
  ReviewPromptStatus as PrismaReviewPromptStatus,
  SourceConfidence as PrismaSourceConfidence,
} from '@kibadist/prisma'

import {
  ARTICLE_LEARNING_EVENT_TYPES,
  REVIEW_PROMPT_STATUSES,
  SOURCE_CONFIDENCE_STATES,
} from './article-learning.types'

/**
 * The TS unions in article-learning.types.ts are the single source of truth for
 * the contract vocabularies (DET-278); the Prisma enums mirror them. This spec
 * fails the moment the two drift — adding a member to one without the other.
 */
describe('contract sync — TS unions match Prisma enums', () => {
  it('ArticleLearningEventType members match (order included)', () => {
    expect([...ARTICLE_LEARNING_EVENT_TYPES]).toEqual(
      Object.values(PrismaArticleLearningEventType),
    )
  })

  it('ReviewPromptStatus members match (order included)', () => {
    expect([...REVIEW_PROMPT_STATUSES]).toEqual(
      Object.values(PrismaReviewPromptStatus),
    )
  })

  it('SourceConfidence members match (order included)', () => {
    expect([...SOURCE_CONFIDENCE_STATES]).toEqual(
      Object.values(PrismaSourceConfidence),
    )
  })
})
