import { OnboardingService } from './onboarding.service'

function makeService() {
  const prisma = {
    onboardingState: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    concept: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    },
    reviewPrompt: { count: jest.fn().mockResolvedValue(0) },
    articleLearningEvent: { findMany: jest.fn().mockResolvedValue([]) },
    transformedArticle: { findFirst: jest.fn(), create: jest.fn() },
    transformerSource: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    },
    transformerSourceBlock: { createMany: jest.fn() },
    $transaction: jest.fn(),
  }
  const conceptState = { recordCapture: jest.fn().mockResolvedValue(undefined) }
  const service = new OnboardingService(prisma as never, conceptState as never)
  return { service, prisma, conceptState }
}

describe('OnboardingService.getStatus', () => {
  it('returns an all-undone, active checklist for a fresh empty workspace', async () => {
    const { service, prisma } = makeService()
    prisma.onboardingState.findUnique.mockResolvedValue(null)

    const status = await service.getStatus('u1', 'w1')

    expect(status.active).toBe(true)
    expect(status.dismissed).toBe(false)
    expect(status.completed).toBe(false)
    expect(status.workspaceEmpty).toBe(true)
    expect(status.starterArticleId).toBeNull()
    expect(status.steps.every((s) => !s.done)).toBe(true)
    // No starter article ⇒ never queries the event log.
    expect(prisma.articleLearningEvent.findMany).not.toHaveBeenCalled()
  })

  it('completes the checklist once every signal is present, stamping completion once', async () => {
    const { service, prisma } = makeService()
    prisma.onboardingState.findUnique.mockResolvedValue({
      starterSourceId: 'src1',
      starterArticleId: 'art1',
      starterConceptId: 'c1',
      completedSteps: ['map'],
      dismissedAt: null,
      completedAt: null,
    })
    prisma.articleLearningEvent.findMany.mockResolvedValue([
      { eventType: 'section_revealed' },
      { eventType: 'prediction_submitted' },
      { eventType: 'concept_candidate_approved' },
      { eventType: 'review_prompt_approved' },
    ])
    // A PERMANENT concept exists (the earned-step signal), and the workspace is no
    // longer empty — both concept counts come back non-zero.
    prisma.concept.count.mockResolvedValue(1)
    prisma.reviewPrompt.count.mockResolvedValue(1)
    prisma.transformerSource.count.mockResolvedValue(1)
    prisma.transformedArticle.findFirst.mockResolvedValue({ status: 'FINAL' })

    const status = await service.getStatus('u1', 'w1')

    expect(status.completed).toBe(true)
    expect(status.active).toBe(false)
    expect(status.workspaceEmpty).toBe(false)
    expect(status.starterArticleStatus).toBe('FINAL')
    expect(status.steps.every((s) => s.done)).toBe(true)
    // Completion is persisted exactly once (idempotent on re-read).
    expect(prisma.onboardingState.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { completedAt: expect.any(Date) },
    })
  })

  it('reports dismissed-forever as inactive', async () => {
    const { service, prisma } = makeService()
    prisma.onboardingState.findUnique.mockResolvedValue({
      starterSourceId: null,
      starterArticleId: null,
      starterConceptId: null,
      completedSteps: [],
      dismissedAt: new Date('2026-06-07T00:00:00.000Z'),
      completedAt: null,
    })

    const status = await service.getStatus('u1', 'w1')
    expect(status.dismissed).toBe(true)
    expect(status.active).toBe(false)
  })
})

describe('OnboardingService.seedStarter', () => {
  it('is idempotent: returns the existing starter when its article still exists', async () => {
    const { service, prisma } = makeService()
    prisma.onboardingState.findUnique.mockResolvedValue({
      starterSourceId: 'src1',
      starterArticleId: 'art1',
      starterConceptId: 'c1',
    })
    prisma.transformedArticle.findFirst.mockResolvedValue({ id: 'art1' })

    const result = await service.seedStarter('u1', 'w1')

    expect(result).toEqual({
      sourceId: 'src1',
      articleId: 'art1',
      conceptId: 'c1',
    })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('creates source + blocks + FINAL article + inbox concept, then records the ids', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.onboardingState.findUnique.mockResolvedValue(null)
    const tx = {
      transformerSource: {
        create: jest.fn().mockResolvedValue({ id: 'src1' }),
      },
      transformerSourceBlock: { createMany: jest.fn().mockResolvedValue({}) },
      transformedArticle: {
        create: jest.fn().mockResolvedValue({ id: 'art1' }),
      },
      concept: { create: jest.fn().mockResolvedValue({ id: 'c1' }) },
    }
    prisma.$transaction.mockImplementation((cb: (t: typeof tx) => unknown) =>
      cb(tx),
    )

    const result = await service.seedStarter('u1', 'w1')

    expect(result).toEqual({
      sourceId: 'src1',
      articleId: 'art1',
      conceptId: 'c1',
    })
    // A FINAL article over the seeded source's version-1 blocks.
    expect(tx.transformedArticle.create.mock.calls[0][0].data.status).toBe(
      'FINAL',
    )
    expect(tx.transformerSourceBlock.createMany).toHaveBeenCalled()
    expect(conceptState.recordCapture).toHaveBeenCalledWith(
      'c1',
      'u1',
      tx,
      expect.stringContaining('DET-307'),
    )
    expect(prisma.onboardingState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        create: expect.objectContaining({
          starterSourceId: 'src1',
          starterArticleId: 'art1',
          starterConceptId: 'c1',
        }),
      }),
    )
  })
})

describe('OnboardingService.update', () => {
  it('dismisses forever and de-duplicates marked steps', async () => {
    const { service, prisma } = makeService()
    prisma.onboardingState.findUnique
      .mockResolvedValueOnce({
        completedSteps: ['map'],
        dismissedAt: null,
        starterArticleId: null,
      })
      // The trailing getStatus re-read.
      .mockResolvedValue({
        completedSteps: ['map'],
        dismissedAt: new Date(),
        starterArticleId: null,
      })

    await service.update('u1', 'w1', { dismissed: true, completedStep: 'map' })

    const call = prisma.onboardingState.upsert.mock.calls[0][0]
    expect(call.update.completedSteps).toEqual(['map'])
    expect(call.update.dismissedAt).toBeInstanceOf(Date)
  })

  it('ignores unknown step keys', async () => {
    const { service, prisma } = makeService()
    prisma.onboardingState.findUnique.mockResolvedValue({
      completedSteps: [],
      dismissedAt: null,
      starterArticleId: null,
    })

    await service.update('u1', 'w1', { completedStep: 'bogus' })

    const call = prisma.onboardingState.upsert.mock.calls[0][0]
    expect(call.update.completedSteps).toEqual([])
  })
})
