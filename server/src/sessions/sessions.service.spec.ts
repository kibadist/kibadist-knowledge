import { NotFoundException } from '@nestjs/common'

import { SessionsService } from './sessions.service'

function makeService() {
  const prisma = {
    session: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn(),
    },
    sessionItem: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue({ id: 'i1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    concept: { findMany: jest.fn().mockResolvedValue([]) },
    // The callback form runs the tx body against the same mock client.
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  )
  const retrieval = {
    grade: jest.fn().mockResolvedValue({ cognitiveState: 'RETRIEVED' }),
  }
  const concepts = {}
  const decay = { sweep: jest.fn().mockResolvedValue(0) }
  const service = new SessionsService(
    prisma as never,
    retrieval as never,
    concepts as never,
    decay as never,
  )
  return { service, prisma, retrieval, decay }
}

describe('SessionsService.start', () => {
  it('creates a Session + ordered SessionItems from due concepts and returns them', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      { id: 'c1', cognitiveState: 'EXPLAINED', nextReviewAt: null },
      {
        id: 'c2',
        cognitiveState: 'RETRIEVED',
        nextReviewAt: new Date('2026-01-01'),
      },
    ])
    prisma.session.create.mockResolvedValue({ id: 's1' })
    // loadSession at the end re-reads the session with its items.
    prisma.session.findFirst
      .mockResolvedValueOnce(null) // no existing ACTIVE session
      .mockResolvedValueOnce({
        id: 's1',
        startedAt: new Date(),
        endedAt: null,
        targetMinutes: 10,
        status: 'ACTIVE',
        items: [
          {
            id: 'i1',
            conceptId: 'c1',
            title: 'First',
            position: 0,
            reason: 'DUE',
            reviewedAt: null,
            recallScore: null,
            concept: { title: 'First' },
          },
          {
            id: 'i2',
            conceptId: 'c2',
            title: 'Second',
            position: 1,
            reason: 'DUE',
            reviewedAt: null,
            recallScore: null,
            concept: { title: 'Second' },
          },
        ],
      })

    const result = await service.start('u1', 10)

    const created = prisma.sessionItem.createMany.mock.calls[0][0].data
    expect(created).toEqual([
      { sessionId: 's1', conceptId: 'c1', position: 0, reason: 'DUE' },
      { sessionId: 's1', conceptId: 'c2', position: 1, reason: 'DUE' },
    ])
    expect(result?.id).toBe('s1')
    expect(result?.items.map((i) => i.conceptId)).toEqual(['c1', 'c2'])
  })

  it('surfaces each item concept cognitiveState so the session view can mark contested items (DET-199)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      { id: 'c1', cognitiveState: 'CONTESTED', nextReviewAt: null },
    ])
    prisma.session.create.mockResolvedValue({ id: 's1' })
    prisma.session.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 's1',
      startedAt: new Date(),
      endedAt: null,
      targetMinutes: 10,
      status: 'ACTIVE',
      items: [
        {
          id: 'i1',
          conceptId: 'c1',
          position: 0,
          reason: 'CONTESTED',
          reviewedAt: null,
          recallScore: null,
          // loadSession selects the concept's cognitiveState alongside title.
          concept: { title: 'Conflicted', cognitiveState: 'CONTESTED' },
        },
      ],
    })

    const result = await service.start('u1', 10)

    expect(result?.items[0].cognitiveState).toBe('CONTESTED')
  })

  it('returns the existing ACTIVE session instead of creating a new one', async () => {
    const { service, prisma } = makeService()
    prisma.session.findFirst
      .mockResolvedValueOnce({ id: 'active', status: 'ACTIVE' }) // existing check
      .mockResolvedValueOnce({ id: 'active', status: 'ACTIVE' }) // getActive: find
      .mockResolvedValueOnce({
        id: 'active',
        startedAt: new Date(),
        endedAt: null,
        targetMinutes: 10,
        status: 'ACTIVE',
        items: [],
      })

    const result = await service.start('u1', 10)

    expect(prisma.session.create).not.toHaveBeenCalled()
    expect(result?.id).toBe('active')
  })

  it('empty-state: picks an INTERNALIZED concept with reason CHALLENGE when nothing is due', async () => {
    const { service, prisma } = makeService()
    // Only a mastered concept exists, not due — the ordinary queue is empty.
    prisma.concept.findMany.mockResolvedValue([
      {
        id: 'mastered',
        cognitiveState: 'INTERNALIZED',
        nextReviewAt: new Date('2099-01-01'),
      },
    ])
    prisma.session.create.mockResolvedValue({ id: 's1' })
    prisma.session.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 's1',
      startedAt: new Date(),
      endedAt: null,
      targetMinutes: 10,
      status: 'ACTIVE',
      items: [
        {
          id: 'i1',
          conceptId: 'mastered',
          position: 0,
          reason: 'CHALLENGE',
          reviewedAt: null,
          recallScore: null,
          concept: { title: 'Mastered' },
        },
      ],
    })

    await service.start('u1', 10)

    const created = prisma.sessionItem.createMany.mock.calls[0][0].data
    expect(created).toEqual([
      {
        sessionId: 's1',
        conceptId: 'mastered',
        position: 0,
        reason: 'CHALLENGE',
      },
    ])
  })
})

describe('SessionsService.reviewItem', () => {
  it('delegates grading to the Retrieval Engine and marks the item reviewed', async () => {
    const { service, prisma, retrieval } = makeService()
    prisma.session.findFirst.mockResolvedValue({ id: 's1' }) // owned + ACTIVE
    prisma.sessionItem.findFirst.mockResolvedValue({ id: 'i1' }) // membership

    const result = await service.reviewItem('u1', 's1', 'c1', 4)

    expect(retrieval.grade).toHaveBeenCalledWith('u1', 'c1', { score: 4 })
    // The item is updated by its unique id (a guaranteed single-row write).
    const update = prisma.sessionItem.update.mock.calls[0][0]
    expect(update.where).toEqual({ id: 'i1' })
    expect(update.data.recallScore).toBe(4)
    expect(update.data.reviewedAt).toBeInstanceOf(Date)
    expect(result.cognitiveState).toBe('RETRIEVED')
  })

  it('throws when the session is not owned/active, without grading', async () => {
    const { service, prisma, retrieval } = makeService()
    prisma.session.findFirst.mockResolvedValue(null)

    await expect(
      service.reviewItem('u1', 's1', 'c1', 4),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(retrieval.grade).not.toHaveBeenCalled()
  })

  it('throws when the concept is not part of the session, without grading', async () => {
    const { service, prisma, retrieval } = makeService()
    prisma.session.findFirst.mockResolvedValue({ id: 's1' }) // owned + ACTIVE
    prisma.sessionItem.findFirst.mockResolvedValue(null) // not a member

    await expect(
      service.reviewItem('u1', 's1', 'rogue', 4),
    ).rejects.toBeInstanceOf(NotFoundException)
    // Critically: no retrieval grade/reschedule for a concept not in the session.
    expect(retrieval.grade).not.toHaveBeenCalled()
  })
})

describe('SessionsService.end', () => {
  it('sets the session COMPLETED with an end timestamp', async () => {
    const { service, prisma } = makeService()
    prisma.session.findFirst
      .mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' }) // ownership + status
      .mockResolvedValueOnce({
        id: 's1',
        startedAt: new Date(),
        endedAt: new Date(),
        targetMinutes: 10,
        status: 'COMPLETED',
        items: [],
      })

    await service.end('u1', 's1')

    const update = prisma.session.updateMany.mock.calls[0][0]
    expect(update.where).toEqual({ id: 's1', userId: 'u1' })
    expect(update.data.status).toBe('COMPLETED')
    expect(update.data.endedAt).toBeInstanceOf(Date)
  })
})
