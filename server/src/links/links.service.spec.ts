import { LinkRelation, LinkStatus, StateTrigger } from '@kibadist/prisma'

import { LinksService } from './links.service'

function makeService() {
  const prisma = {
    link: {
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const conceptState = { transition: jest.fn().mockResolvedValue('CONTESTED') }
  const service = new LinksService(
    prisma as never,
    concepts as never,
    conceptState as never,
  )
  return { service, prisma, concepts, conceptState }
}

describe('LinksService contradiction → CONTESTED', () => {
  it('contests the target when a CONFIRMED contradiction is created', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.link.create.mockResolvedValue({
      id: 'l1',
      sourceConceptId: 's1',
      targetConceptId: 't1',
      relationKind: LinkRelation.CONTRADICTION,
      status: LinkStatus.CONFIRMED,
      sourceConcept: { id: 's1', title: 'S' },
      targetConcept: { id: 't1', title: 'T' },
    })

    await service.create('u1', {
      sourceConceptId: 's1',
      targetConceptId: 't1',
      relationKind: LinkRelation.CONTRADICTION,
      status: LinkStatus.CONFIRMED,
    })

    expect(conceptState.transition).toHaveBeenCalledWith({
      conceptId: 't1',
      userId: 'u1',
      to: 'CONTESTED',
      trigger: StateTrigger.CONTRADICTION,
      note: 'contradicted by s1',
    })
  })

  it('does not contest for a non-contradiction confirmed link', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.link.create.mockResolvedValue({
      id: 'l1',
      sourceConceptId: 's1',
      targetConceptId: 't1',
      relationKind: LinkRelation.SUPPORTS,
      status: LinkStatus.CONFIRMED,
      sourceConcept: { id: 's1', title: 'S' },
      targetConcept: { id: 't1', title: 'T' },
    })
    await service.create('u1', {
      sourceConceptId: 's1',
      targetConceptId: 't1',
      relationKind: LinkRelation.SUPPORTS,
      status: LinkStatus.CONFIRMED,
    })
    expect(conceptState.transition).not.toHaveBeenCalled()
  })

  it('contests on update when a proposal is confirmed as a contradiction', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.link.update.mockResolvedValue({
      id: 'l1',
      sourceConceptId: 's1',
      targetConceptId: 't1',
      relationKind: LinkRelation.CONTRADICTION,
      status: LinkStatus.CONFIRMED,
    })
    prisma.link.findFirst.mockResolvedValue({ id: 'l1' })

    await service.update('u1', 'l1', { status: LinkStatus.CONFIRMED })

    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'CONTESTED', conceptId: 't1' }),
    )
  })

  it('does not fail the link write when the CONTESTED transition is illegal', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.link.create.mockResolvedValue({
      id: 'l1',
      sourceConceptId: 's1',
      targetConceptId: 't1',
      relationKind: LinkRelation.CONTRADICTION,
      status: LinkStatus.CONFIRMED,
      sourceConcept: { id: 's1', title: 'S' },
      targetConcept: { id: 't1', title: 'T' },
    })
    conceptState.transition.mockRejectedValue(new Error('illegal transition'))

    await expect(
      service.create('u1', {
        sourceConceptId: 's1',
        targetConceptId: 't1',
        relationKind: LinkRelation.CONTRADICTION,
        status: LinkStatus.CONFIRMED,
      }),
    ).resolves.toMatchObject({ id: 'l1' })
  })
})

describe('LinksService.reject', () => {
  it('updates an existing proposal to REJECTED', async () => {
    const { service, prisma } = makeService()
    prisma.link.findFirst.mockResolvedValue({ id: 'l1' })
    prisma.link.update.mockResolvedValue({ id: 'l1', status: 'REJECTED' })
    await service.reject('u1', 's1', 't1')
    expect(prisma.link.update).toHaveBeenCalledWith({
      where: { id: 'l1' },
      data: { status: LinkStatus.REJECTED },
    })
  })

  it('creates a REJECTED row when none exists, asserting earned endpoints', async () => {
    const { service, prisma, concepts } = makeService()
    prisma.link.findFirst.mockResolvedValue(null)
    prisma.link.create.mockResolvedValue({ id: 'l2', status: 'REJECTED' })
    await service.reject('u1', 's1', 't1')
    expect(concepts.assertOwnedNonInbox).toHaveBeenCalledWith('u1', 's1')
    expect(concepts.assertOwnedNonInbox).toHaveBeenCalledWith('u1', 't1')
    expect(prisma.link.create.mock.calls[0][0].data.status).toBe(
      LinkStatus.REJECTED,
    )
  })
})
