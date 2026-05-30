import { CognitiveState, LinkStatus } from '@kibadist/prisma'

import { MetricsService } from './metrics.service'

function makeService() {
  const prisma = {
    retrievalEvent: { count: jest.fn() },
    concept: { count: jest.fn() },
    link: { count: jest.fn() },
    reflection: { count: jest.fn() },
    conceptStateTransition: { findMany: jest.fn() },
  }
  const service = new MetricsService(prisma as never)
  return { service, prisma }
}

describe('MetricsService.forUser', () => {
  it('computes the retrieval success rate from passed / total graded', async () => {
    const { service, prisma } = makeService()
    // retrievalEvent.count is called twice: [total graded, passed].
    prisma.retrievalEvent.count
      .mockResolvedValueOnce(10) // total graded
      .mockResolvedValueOnce(8) // passed (score >= 3)
    prisma.concept.count.mockResolvedValue(0)
    prisma.link.count.mockResolvedValue(0)
    prisma.reflection.count.mockResolvedValue(0)
    prisma.conceptStateTransition.findMany.mockResolvedValue([])

    const result = await service.forUser('u1')

    expect(result.retrievalSuccessRate).toBe(0.8)
    expect(result.retrievalsPassed).toBe(8)
    expect(result.retrievalsTotal).toBe(10)
  })

  it('returns a null rate when there are no graded retrievals', async () => {
    const { service, prisma } = makeService()
    prisma.retrievalEvent.count
      .mockResolvedValueOnce(0) // total graded
      .mockResolvedValueOnce(0) // passed
    prisma.concept.count.mockResolvedValue(0)
    prisma.link.count.mockResolvedValue(0)
    prisma.reflection.count.mockResolvedValue(0)
    prisma.conceptStateTransition.findMany.mockResolvedValue([])

    const result = await service.forUser('u1')

    expect(result.retrievalSuccessRate).toBeNull()
    expect(result.retrievalsTotal).toBe(0)
  })

  it('returns the synthesis/depth counts', async () => {
    const { service, prisma } = makeService()
    prisma.retrievalEvent.count.mockResolvedValue(0)
    // concept.count order: [retained, internalized, defended].
    prisma.concept.count
      .mockResolvedValueOnce(7) // retained
      .mockResolvedValueOnce(3) // internalized
      .mockResolvedValueOnce(2) // defended
    prisma.link.count.mockResolvedValue(5) // CONFIRMED connections
    prisma.reflection.count.mockResolvedValue(4)
    prisma.conceptStateTransition.findMany.mockResolvedValue([])

    const result = await service.forUser('u1')

    expect(result.conceptsRetained).toBe(7)
    expect(result.conceptsInternalized).toBe(3)
    expect(result.conceptsDefended).toBe(2)
    expect(result.connectionsValidated).toBe(5)
    expect(result.reflectionsLogged).toBe(4)
    // CONFIRMED is the only link status that counts as validated.
    expect(prisma.link.count).toHaveBeenCalledWith({
      where: { userId: 'u1', status: LinkStatus.CONFIRMED },
    })
  })

  it('counts only forward transitions in the window', async () => {
    const { service, prisma } = makeService()
    prisma.retrievalEvent.count.mockResolvedValue(0)
    prisma.concept.count.mockResolvedValue(0)
    prisma.link.count.mockResolvedValue(0)
    prisma.reflection.count.mockResolvedValue(0)
    prisma.conceptStateTransition.findMany.mockResolvedValue([
      // forward
      { from: CognitiveState.EXPLAINED, to: CognitiveState.RETRIEVED },
      { from: CognitiveState.RETRIEVED, to: CognitiveState.DEFENDED },
      { from: null, to: CognitiveState.EXPLAINED },
      // not forward: same rank, decay, archive
      { from: CognitiveState.EXPLAINED, to: CognitiveState.LINKED },
      { from: CognitiveState.INTERNALIZED, to: CognitiveState.DORMANT },
      { from: CognitiveState.RETRIEVED, to: CognitiveState.ARCHIVED },
    ])

    const result = await service.forUser('u1')

    expect(result.forwardTransitions30d).toBe(3)
  })

  it('scopes the transition window to the user and a recent date', async () => {
    const { service, prisma } = makeService()
    prisma.retrievalEvent.count.mockResolvedValue(0)
    prisma.concept.count.mockResolvedValue(0)
    prisma.link.count.mockResolvedValue(0)
    prisma.reflection.count.mockResolvedValue(0)
    prisma.conceptStateTransition.findMany.mockResolvedValue([])

    await service.forUser('u1')

    const arg = prisma.conceptStateTransition.findMany.mock.calls[0][0]
    expect(arg.where.userId).toBe('u1')
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date)
  })
})
