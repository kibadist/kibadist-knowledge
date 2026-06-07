import { ReviewPromptService } from './review-prompt.service'

function makeService() {
  const prisma = {
    reviewPrompt: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  }
  const service = new ReviewPromptService(prisma as never)
  return { service, prisma }
}

// A representative Prisma row (camelCase, Date timestamps, nullable scalars).
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rp_row_1',
    userId: 'u1',
    articleId: 'art_1',
    articleVersionId: null,
    sectionId: null,
    conceptId: null,
    promptId: 'rp_sec_1_transfer_spacing',
    promptType: 'transfer',
    origin: 'corrected_rewrite',
    subject: 'Spaced repetition',
    question: 'How would you apply spacing to a new skill?',
    expectedAnswerSummary: 'Schedule expanding-interval reviews.',
    sourceSpanIds: [],
    createdFromEventId: null,
    status: 'approved',
    nextReviewAt: null,
    createdAt: new Date('2026-06-06T00:00:00.000Z'),
    updatedAt: new Date('2026-06-06T00:00:00.000Z'),
    ...overrides,
  }
}

describe('ReviewPromptService.listForUser', () => {
  it('scopes to the user (and article when given), newest first, mapped to the wire contract', async () => {
    const { service, prisma } = makeService()
    prisma.reviewPrompt.findMany.mockResolvedValue([
      row({ sectionId: 'sec_1', conceptId: 'c1' }),
    ])

    const prompts = await service.listForUser('u1', 'art_1')

    expect(prisma.reviewPrompt.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', articleId: 'art_1' },
      orderBy: { createdAt: 'desc' },
    })
    expect(prompts[0]).toEqual({
      id: 'rp_row_1',
      user_id: 'u1',
      prompt_id: 'rp_sec_1_transfer_spacing',
      article_id: 'art_1',
      article_version_id: undefined,
      section_id: 'sec_1',
      concept_id: 'c1',
      prompt_type: 'transfer',
      origin: 'corrected_rewrite',
      subject: 'Spaced repetition',
      question: 'How would you apply spacing to a new skill?',
      expected_answer_summary: 'Schedule expanding-interval reviews.',
      source_span_ids: [],
      created_from_event_id: undefined,
      status: 'approved',
      next_review_at: undefined,
      created_at: '2026-06-06T00:00:00.000Z',
      updated_at: '2026-06-06T00:00:00.000Z',
    })
  })

  it('omits the article filter when no articleId is given', async () => {
    const { service, prisma } = makeService()
    prisma.reviewPrompt.findMany.mockResolvedValue([])

    await service.listForUser('u1')

    expect(prisma.reviewPrompt.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'desc' },
    })
  })
})

describe('ReviewPromptService.approve', () => {
  it('upserts idempotently on (userId, promptId), forcing the JWT user and approved status', async () => {
    const { service, prisma } = makeService()
    prisma.reviewPrompt.upsert.mockResolvedValue(row())

    await service.approve('u1', {
      prompt_id: 'rp_sec_1_transfer_spacing',
      article_id: 'art_1',
      prompt_type: 'transfer',
      origin: 'corrected_rewrite',
      subject: 'Spaced repetition',
      question: 'How would you apply spacing to a new skill?',
      expected_answer_summary: 'Schedule expanding-interval reviews.',
      // A client-supplied user must be ignored; status is set server-side.
    } as never)

    const call = prisma.reviewPrompt.upsert.mock.calls[0][0]
    expect(call.where).toEqual({
      userId_promptId: { userId: 'u1', promptId: 'rp_sec_1_transfer_spacing' },
    })
    expect(call.create.userId).toBe('u1')
    expect(call.create.promptId).toBe('rp_sec_1_transfer_spacing')
    expect(call.create.status).toBe('approved')
    expect(call.update.userId).toBe('u1')
    expect(call.update.status).toBe('approved')
    // Optional scalars default to null; spans default to [].
    expect(call.create.articleVersionId).toBeNull()
    expect(call.create.sectionId).toBeNull()
    expect(call.create.conceptId).toBeNull()
    expect(call.create.createdFromEventId).toBeNull()
    expect(call.create.sourceSpanIds).toEqual([])
  })

  it('carries through optional anchors when present', async () => {
    const { service, prisma } = makeService()
    prisma.reviewPrompt.upsert.mockResolvedValue(row())

    await service.approve('u1', {
      prompt_id: 'rp_c1_definition_recall_x',
      article_id: 'art_1',
      article_version_id: 'v2',
      section_id: 'sec_1',
      concept_id: 'c1',
      prompt_type: 'definition_recall',
      origin: 'approved_concept_candidate',
      subject: 'X',
      question: 'Define X.',
      expected_answer_summary: 'X is ...',
      source_span_ids: ['blk_1', 'blk_2'],
      created_from_event_id: 'ale_9',
    } as never)

    const { create } = prisma.reviewPrompt.upsert.mock.calls[0][0]
    expect(create.articleVersionId).toBe('v2')
    expect(create.sectionId).toBe('sec_1')
    expect(create.conceptId).toBe('c1')
    expect(create.sourceSpanIds).toEqual(['blk_1', 'blk_2'])
    expect(create.createdFromEventId).toBe('ale_9')
  })
})
