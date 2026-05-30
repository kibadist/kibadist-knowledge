import { StateTrigger } from '@kibadist/prisma'
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { TutorService } from './tutor.service'

/**
 * A Prisma double whose `$transaction(fn)` runs the callback against a `tx` that
 * shares the same model mocks, mirroring how the service writes the articulation
 * + retrieval event inside one transaction.
 */
function makeService() {
  const prisma = {
    concept: {
      findFirst: jest.fn().mockResolvedValue({
        title: 'Compound interest',
        cognitiveState: 'DEFENDED',
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    articulation: {
      findFirst: jest.fn().mockResolvedValue({ body: 'my compression' }),
      create: jest.fn().mockResolvedValue({ id: 'art1', body: 'my response' }),
    },
    retrievalEvent: {
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      count: jest.fn().mockResolvedValue(0),
    },
    link: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  }
  // Run the tx callback against prisma itself (same model mocks act as `tx`).
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  )

  const ai = { complete: jest.fn() }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const conceptState = {
    transition: jest.fn().mockResolvedValue('DEFENDED'),
  }
  const search = { indexArticulation: jest.fn().mockResolvedValue(undefined) }

  const service = new TutorService(
    prisma as never,
    ai as never,
    concepts as never,
    conceptState as never,
    search as never,
  )
  return { service, prisma, ai, concepts, conceptState, search }
}

describe('TutorService.challenge', () => {
  it('calls ai.complete and persists nothing', async () => {
    const { service, prisma, ai } = makeService()
    ai.complete.mockResolvedValue({ text: 'Why is this true?', model: 'test' })

    const out = await service.challenge('u1', 'c1')

    expect(out.question).toBe('Why is this true?')
    expect(ai.complete).toHaveBeenCalledTimes(1)
    expect(prisma.articulation.create).not.toHaveBeenCalled()
    expect(prisma.retrievalEvent.create).not.toHaveBeenCalled()
  })

  it('throws ServiceUnavailable when the parse yields null', async () => {
    const { service, ai } = makeService()
    ai.complete.mockResolvedValue({ text: '   ', model: 'test' })

    await expect(service.challenge('u1', 'c1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
  })

  it('throws BadRequest when no articulation exists', async () => {
    const { service, prisma, ai } = makeService()
    prisma.articulation.findFirst.mockResolvedValue(null)

    await expect(service.challenge('u1', 'c1')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(ai.complete).not.toHaveBeenCalled()
  })
})

describe('TutorService.respond', () => {
  it('defended=true creates a scored-null event + articulation and promotes to DEFENDED', async () => {
    const { service, prisma, conceptState, search } = makeService()

    await service.respond('u1', 'c1', {
      question: 'Why?',
      response: 'my response',
      defended: true,
    })

    expect(prisma.articulation.create).toHaveBeenCalledWith({
      data: { body: 'my response', conceptId: 'c1', userId: 'u1' },
    })
    expect(prisma.retrievalEvent.create).toHaveBeenCalledWith({
      data: {
        conceptId: 'c1',
        userId: 'u1',
        question: 'Why?',
        response: 'my response',
        score: null,
      },
    })
    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'DEFENDED',
        trigger: StateTrigger.TUTOR_DEFENDED,
      }),
      prisma,
    )
    expect(search.indexArticulation).toHaveBeenCalledWith('art1', 'my response')
  })

  it('defended=false creates the articulation, does not transition, and pulls the next review sooner', async () => {
    const { service, prisma, conceptState } = makeService()

    await service.respond('u1', 'c1', {
      question: 'Why?',
      response: 'found a gap',
      defended: false,
    })

    expect(prisma.articulation.create).toHaveBeenCalled()
    expect(conceptState.transition).not.toHaveBeenCalled()
    expect(prisma.concept.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nextReviewAt: expect.any(Date) }),
      }),
    )
  })

  it('catches an illegal DEFENDED transition and still persists the articulation', async () => {
    const { service, prisma, conceptState, search } = makeService()
    conceptState.transition.mockRejectedValue(
      new Error('Illegal cognitive-state transition EXPLAINED → DEFENDED'),
    )

    const out = await service.respond('u1', 'c1', {
      question: 'Why?',
      response: 'my response',
      defended: true,
    })

    expect(prisma.articulation.create).toHaveBeenCalled()
    expect(out.articulation).toEqual({ id: 'art1', body: 'my response' })
    expect(search.indexArticulation).toHaveBeenCalledWith('art1', 'my response')
  })
})
