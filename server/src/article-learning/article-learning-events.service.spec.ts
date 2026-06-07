import { ArticleLearningEventsService } from './article-learning-events.service'

function makeService() {
  const prisma = {
    articleLearningEvent: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  }
  const service = new ArticleLearningEventsService(prisma as never)
  return { service, prisma }
}

// A representative Prisma row (camelCase, Date timestamps, nullable scalars).
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ale_1',
    userId: 'u1',
    articleId: 'art_1',
    articleVersionId: null,
    sectionId: null,
    blockId: null,
    sourceSpanIds: [],
    eventType: 'section_revealed',
    prompt: null,
    userAnswer: null,
    aiFeedback: null,
    metadata: {},
    createdAt: new Date('2026-06-06T00:00:00.000Z'),
    updatedAt: new Date('2026-06-06T00:00:00.000Z'),
    ...overrides,
  }
}

describe('ArticleLearningEventsService.listForUser', () => {
  it('scopes to the user + article, oldest first, and maps to the snake_case contract', async () => {
    const { service, prisma } = makeService()
    prisma.articleLearningEvent.findMany.mockResolvedValue([
      row({
        sectionId: 'sec_1',
        eventType: 'prediction_submitted',
        userAnswer: 'my words',
        metadata: { surface: 'deep_reading_mode' },
      }),
    ])

    const events = await service.listForUser('u1', 'art_1')

    expect(prisma.articleLearningEvent.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', articleId: 'art_1' },
      orderBy: { createdAt: 'asc' },
    })
    expect(events[0]).toEqual({
      id: 'ale_1',
      user_id: 'u1',
      article_id: 'art_1',
      article_version_id: undefined,
      section_id: 'sec_1',
      block_id: undefined,
      source_span_ids: [],
      event_type: 'prediction_submitted',
      prompt: undefined,
      user_answer: 'my words',
      ai_feedback: undefined,
      metadata: { surface: 'deep_reading_mode' },
      created_at: '2026-06-06T00:00:00.000Z',
      updated_at: '2026-06-06T00:00:00.000Z',
    })
  })
})

describe('ArticleLearningEventsService.create', () => {
  it('stamps the JWT user (never the body), defaults metadata, and returns the wire shape', async () => {
    const { service, prisma } = makeService()
    prisma.articleLearningEvent.create.mockResolvedValue(
      row({ sectionId: 'sec_1', eventType: 'block_rewrite_submitted' }),
    )

    await service.create('u1', {
      article_id: 'art_1',
      section_id: 'sec_1',
      event_type: 'block_rewrite_submitted',
      user_answer: 'reconstruction',
    } as never)

    const data = prisma.articleLearningEvent.create.mock.calls[0][0].data
    expect(data.userId).toBe('u1')
    expect(data.articleId).toBe('art_1')
    expect(data.sectionId).toBe('sec_1')
    expect(data.eventType).toBe('block_rewrite_submitted')
    expect(data.userAnswer).toBe('reconstruction')
    // Optional scalars become null; metadata defaults to {}.
    expect(data.articleVersionId).toBeNull()
    expect(data.blockId).toBeNull()
    expect(data.sourceSpanIds).toEqual([])
    expect(data.metadata).toEqual({})
  })
})
