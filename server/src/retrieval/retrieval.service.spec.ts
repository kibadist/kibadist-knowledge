import { ConceptStatus, StateTrigger } from '@kibadist/prisma'

import { RetrievalService } from './retrieval.service'

function makeService() {
  const prisma = {
    concept: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      // Conditional, concurrency-safe schedule write keyed on {id, userId}.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    articulation: { findFirst: jest.fn() },
    link: { findMany: jest.fn().mockResolvedValue([]) },
    retrievalEvent: { create: jest.fn(), findMany: jest.fn() },
    // The callback form runs the tx body against the same mock client.
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  )
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const conceptState = {
    transition: jest.fn().mockResolvedValue('RETRIEVED'),
  }
  // A grade refreshes the concept's activation (DET-195), best-effort after the tx.
  const decay = {
    refresh: jest.fn().mockResolvedValue(undefined),
  }
  const service = new RetrievalService(
    prisma as never,
    concepts as never,
    conceptState as never,
    decay as never,
  )
  return { service, prisma, concepts, conceptState, decay }
}

describe('RetrievalService.grade', () => {
  it('records a RetrievalEvent, advances the SM-2 schedule, and transitions to RETRIEVED on a pass', async () => {
    const { service, prisma, conceptState } = makeService()
    // The in-tx read returns the schedule + current state together (no post-tx
    // re-read). EXPLAINED → a pass advances it to RETRIEVED.
    prisma.concept.findFirst.mockResolvedValue({
      reviewEase: 2.5,
      reviewIntervalDays: 0,
      reviewReps: 0,
      cognitiveState: 'EXPLAINED',
    })

    const result = await service.grade('u1', 'c1', { score: 4 })

    // (a) the event is recorded.
    expect(prisma.retrievalEvent.create).toHaveBeenCalledWith({
      data: {
        conceptId: 'c1',
        userId: 'u1',
        question: undefined,
        response: undefined,
        score: 4,
      },
    })
    // (b) schedule advanced: first pass → interval 1, reps 1; keyed on id+userId.
    const update = prisma.concept.updateMany.mock.calls[0][0]
    expect(update.where).toEqual({ id: 'c1', userId: 'u1' })
    expect(update.data.reviewReps).toBe(1)
    expect(update.data.reviewIntervalDays).toBe(1)
    expect(update.data.nextReviewAt).toBeInstanceOf(Date)
    // (c) transition to RETRIEVED with the retrieval-success trigger.
    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptId: 'c1',
        userId: 'u1',
        to: 'RETRIEVED',
        trigger: StateTrigger.RETRIEVAL_SUCCESS,
      }),
      prisma,
    )
    expect(result.cognitiveState).toBe('RETRIEVED')
    expect(result.reviewReps).toBe(1)
  })

  it('refreshes the concept activation after grading (a review keeps it alive)', async () => {
    const { service, prisma, decay } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      reviewEase: 2.5,
      reviewIntervalDays: 0,
      reviewReps: 0,
      cognitiveState: 'EXPLAINED',
    })

    await service.grade('u1', 'c1', { score: 4 })

    expect(decay.refresh).toHaveBeenCalledWith('u1', 'c1')
  })

  it('transitions to INTERNALIZED once recall is sustained (reps reaches 3)', async () => {
    const { service, prisma, conceptState } = makeService()
    conceptState.transition.mockResolvedValue('INTERNALIZED')
    // Two prior passes already on record, already RETRIEVED → this pass makes
    // reps 3 and INTERNALIZED (rank 4) advances past RETRIEVED (rank 2).
    prisma.concept.findFirst.mockResolvedValue({
      reviewEase: 2.5,
      reviewIntervalDays: 6,
      reviewReps: 2,
      cognitiveState: 'RETRIEVED',
    })

    const result = await service.grade('u1', 'c1', { score: 5 })

    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'INTERNALIZED',
        trigger: StateTrigger.INTERNALIZED,
      }),
      prisma,
    )
    expect(result.reviewReps).toBe(3)
    expect(result.cognitiveState).toBe('INTERNALIZED')
  })

  it('on a lapse (score < 3) records the event + schedule but does NOT transition state', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      reviewEase: 2.5,
      reviewIntervalDays: 20,
      reviewReps: 4,
      cognitiveState: 'RETRIEVED',
    })

    const result = await service.grade('u1', 'c1', { score: 1 })

    expect(prisma.retrievalEvent.create).toHaveBeenCalled()
    // Lapse: reps reset to 0, interval pulled back to 1.
    const update = prisma.concept.updateMany.mock.calls[0][0]
    expect(update.data.reviewReps).toBe(0)
    expect(update.data.reviewIntervalDays).toBe(1)
    // No state change on a lapse (decay is DET-195).
    expect(conceptState.transition).not.toHaveBeenCalled()
    expect(result.cognitiveState).toBe('RETRIEVED')
  })

  it('does not demote an already-INTERNALIZED concept on a post-lapse pass', async () => {
    const { service, prisma, conceptState } = makeService()
    // A lapse reset reps to 0; the next single pass would target RETRIEVED, but
    // RETRIEVED (rank 2) does NOT advance past INTERNALIZED (rank 4) → skipped.
    prisma.concept.findFirst.mockResolvedValue({
      reviewEase: 2.5,
      reviewIntervalDays: 1,
      reviewReps: 0,
      cognitiveState: 'INTERNALIZED',
    })

    const result = await service.grade('u1', 'c1', { score: 4 })

    expect(conceptState.transition).not.toHaveBeenCalled()
    expect(result.cognitiveState).toBe('INTERNALIZED')
  })

  it('a caught illegal transition never rolls back the event + schedule (falls through candidates)', async () => {
    const { service, prisma, conceptState } = makeService()
    // Both INTERNALIZED and the RETRIEVED fallback reject; the recorded event +
    // schedule still survive and the state is left unchanged.
    conceptState.transition.mockRejectedValue(new Error('Illegal transition'))
    prisma.concept.findFirst.mockResolvedValue({
      reviewEase: 2.5,
      reviewIntervalDays: 6,
      reviewReps: 2,
      cognitiveState: 'EXPLAINED',
    })

    const result = await service.grade('u1', 'c1', { score: 5 })

    expect(prisma.retrievalEvent.create).toHaveBeenCalled()
    expect(prisma.concept.updateMany).toHaveBeenCalled()
    // reps 2 → 3 means both INTERNALIZED and RETRIEVED were attempted.
    expect(conceptState.transition).toHaveBeenCalledTimes(2)
    expect(result.cognitiveState).toBe('EXPLAINED')
  })
})

describe('RetrievalService.due — excludes DORMANT (DET-195)', () => {
  it('queries only non-INBOX concepts that are neither ARCHIVED nor DORMANT', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([])

    await service.due('u1')

    const where = prisma.concept.findMany.mock.calls[0][0].where
    // DORMANT is excluded from active scheduling — sessions surface it via the
    // separate dormant-rediscovery bucket instead.
    expect(where.cognitiveState).toEqual({ notIn: ['ARCHIVED', 'DORMANT'] })
    expect(where.status).toEqual({ not: ConceptStatus.INBOX })
  })
})

describe('RetrievalService.cardsFor — compression, not source', () => {
  it('pulls the LATEST articulation and never reads sourceText/sourceDocument', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({ title: 'Spaced repetition' })
    prisma.articulation.findFirst.mockResolvedValue({
      body: 'Reviewing material at increasing intervals improves recall.',
    })

    const cards = await service.cardsFor('u1', 'c1')

    // The compression query targets the articulation, newest-first.
    expect(prisma.articulation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conceptId: 'c1', userId: 'u1' },
        orderBy: { createdAt: 'desc' },
      }),
    )
    // The concept lookup selects only the title — never sourceText/sourceDocument.
    const conceptSelect = prisma.concept.findFirst.mock.calls[0][0].select
    expect(conceptSelect).toEqual({ title: true })
    expect(conceptSelect).not.toHaveProperty('sourceText')
    expect(conceptSelect).not.toHaveProperty('sourceDocument')
    // And cards were actually derived from that compression.
    expect(cards.some((c) => c.type === 'CLOZE')).toBe(true)
    expect(cards.every((c) => c.fromCompression === true)).toBe(true)
  })
})
