import { ReflectionKind, StateTrigger } from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { ReflectionService } from './reflection.service'

/**
 * A Prisma double with the model methods Reflection touches. The session lookup
 * defaults to an owned session; concept.findFirst returns a RETRIEVED concept so
 * the CLEARER path has a state to advance from.
 */
function makeService() {
  const prisma = {
    session: {
      findFirst: jest.fn().mockResolvedValue({ id: 's1' }),
    },
    reflection: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'ref1', createdAt: new Date(), ...data }),
        ),
      findMany: jest.fn().mockResolvedValue([{ id: 'ref1' }]),
    },
    concept: {
      findFirst: jest.fn().mockResolvedValue({ cognitiveState: 'RETRIEVED' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }

  const conceptState = {
    transition: jest.fn().mockResolvedValue('DEFENDED'),
  }
  const connector = {
    proposeAndPersist: jest.fn().mockResolvedValue(undefined),
  }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }

  const service = new ReflectionService(
    prisma as never,
    conceptState as never,
    connector as never,
    concepts as never,
  )
  return { service, prisma, conceptState, connector, concepts }
}

describe('ReflectionService.record', () => {
  it('persists a Reflection row per item', async () => {
    const { service, prisma } = makeService()

    const created = await service.record('u1', 's1', [
      { conceptId: 'c1', kind: ReflectionKind.LESS_CLEAR },
      { conceptId: 'c2', kind: ReflectionKind.LESS_CLEAR, note: 'fuzzy' },
    ])

    expect(prisma.reflection.create).toHaveBeenCalledTimes(2)
    expect(created).toHaveLength(2)
  })

  it('CLEARER advances cognitive state toward mastery (RETRIEVED → DEFENDED)', async () => {
    const { service, conceptState } = makeService()

    await service.record('u1', 's1', [
      { conceptId: 'c1', kind: ReflectionKind.CLEARER },
    ])

    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptId: 'c1',
        to: 'DEFENDED',
        trigger: StateTrigger.TUTOR_DEFENDED,
      }),
    )
  })

  it('CLEARER does not demote an INTERNALIZED concept', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      cognitiveState: 'INTERNALIZED',
    })

    await service.record('u1', 's1', [
      { conceptId: 'c1', kind: ReflectionKind.CLEARER },
    ])

    expect(conceptState.transition).not.toHaveBeenCalled()
  })

  it('LESS_CLEAR pulls the next review sooner', async () => {
    const { service, prisma } = makeService()

    await service.record('u1', 's1', [
      { conceptId: 'c1', kind: ReflectionKind.LESS_CLEAR },
    ])

    expect(prisma.concept.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', userId: 'u1' },
        data: expect.objectContaining({ nextReviewAt: expect.any(Date) }),
      }),
    )
  })

  it('CONNECTED kicks off a connector pass', async () => {
    const { service, connector } = makeService()

    await service.record('u1', 's1', [
      { conceptId: 'c1', kind: ReflectionKind.CONNECTED },
    ])

    expect(connector.proposeAndPersist).toHaveBeenCalledWith('u1', 'c1')
  })

  it('CHALLENGE_NEXT flags the concept for a Tutor challenge', async () => {
    const { service, prisma } = makeService()

    await service.record('u1', 's1', [
      { conceptId: 'c1', kind: ReflectionKind.CHALLENGE_NEXT },
    ])

    expect(prisma.concept.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', userId: 'u1' },
        data: { tutorRequested: true },
      }),
    )
  })

  it('a failing effect does NOT prevent the Reflection row being created', async () => {
    const { service, prisma, connector } = makeService()
    connector.proposeAndPersist.mockRejectedValue(new Error('connector down'))

    const created = await service.record('u1', 's1', [
      { conceptId: 'c1', kind: ReflectionKind.CONNECTED },
    ])

    expect(prisma.reflection.create).toHaveBeenCalledTimes(1)
    expect(created).toHaveLength(1)
  })

  it('throws NotFound for a session the user does not own', async () => {
    const { service, prisma } = makeService()
    prisma.session.findFirst.mockResolvedValue(null)

    await expect(
      service.record('u1', 's1', [
        { conceptId: 'c1', kind: ReflectionKind.CLEARER },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.reflection.create).not.toHaveBeenCalled()
  })
})

describe('ReflectionService.forConcept', () => {
  it('returns the concept reflections newest-first', async () => {
    const { service, prisma, concepts } = makeService()

    const rows = await service.forConcept('u1', 'c1')

    expect(concepts.assertOwnedNonInbox).toHaveBeenCalledWith('u1', 'c1')
    expect(prisma.reflection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conceptId: 'c1', userId: 'u1' },
        orderBy: { createdAt: 'desc' },
      }),
    )
    expect(rows).toEqual([{ id: 'ref1' }])
  })
})
