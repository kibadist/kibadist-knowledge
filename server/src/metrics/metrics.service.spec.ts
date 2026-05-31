import { CognitiveState, LinkStatus, StateTrigger } from '@kibadist/prisma'

import { MetricsService } from './metrics.service'

function makeService() {
  const prisma = {
    retrievalEvent: { count: jest.fn(), findMany: jest.fn() },
    concept: { count: jest.fn() },
    link: { count: jest.fn(), findMany: jest.fn() },
    reflection: { count: jest.fn() },
    conceptStateTransition: { findMany: jest.fn(), count: jest.fn() },
    articulation: { findMany: jest.fn() },
  }
  const service = new MetricsService(prisma as never)
  return { service, prisma }
}

// Apply zero/empty defaults to every mock so a test only has to override what it
// asserts on. Counts default to 0; findMany default to [].
function withEmptyDefaults(prisma: ReturnType<typeof makeService>['prisma']) {
  prisma.retrievalEvent.count.mockResolvedValue(0)
  prisma.retrievalEvent.findMany.mockResolvedValue([])
  prisma.concept.count.mockResolvedValue(0)
  prisma.link.count.mockResolvedValue(0)
  prisma.link.findMany.mockResolvedValue([])
  prisma.reflection.count.mockResolvedValue(0)
  prisma.conceptStateTransition.findMany.mockResolvedValue([])
  prisma.conceptStateTransition.count.mockResolvedValue(0)
  prisma.articulation.findMany.mockResolvedValue([])
}

describe('MetricsService.forUser', () => {
  it('computes the retrieval success rate from passed / total graded', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    // retrievalEvent.count is called twice: [total graded, passed].
    prisma.retrievalEvent.count
      .mockResolvedValueOnce(10) // total graded
      .mockResolvedValueOnce(8) // passed (score >= 3)

    const result = await service.forUser('u1')

    expect(result.retrievalSuccessRate).toBe(0.8)
    expect(result.retrievalsPassed).toBe(8)
    expect(result.retrievalsTotal).toBe(10)
  })

  it('returns a null rate when there are no graded retrievals', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    prisma.retrievalEvent.count
      .mockResolvedValueOnce(0) // total graded
      .mockResolvedValueOnce(0) // passed

    const result = await service.forUser('u1')

    expect(result.retrievalSuccessRate).toBeNull()
    expect(result.retrievalsTotal).toBe(0)
  })

  it('returns the synthesis/depth counts', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    // concept.count order: [retained, internalized, defended,
    // advancedConceptCount, gradedConceptScope].
    prisma.concept.count
      .mockResolvedValueOnce(7) // retained
      .mockResolvedValueOnce(3) // internalized
      .mockResolvedValueOnce(2) // defended
      .mockResolvedValueOnce(0) // advanced numerator (unused here)
      .mockResolvedValueOnce(0) // advanced denominator
    prisma.link.count.mockResolvedValue(5) // CONFIRMED connections
    prisma.reflection.count.mockResolvedValue(4)

    const result = await service.forUser('u1')

    expect(result.conceptsRetained).toBe(7)
    expect(result.conceptsInternalized).toBe(3)
    expect(result.conceptsDefended).toBe(2)
    expect(result.connectionsValidated).toBe(5)
    expect(result.reflectionsLogged).toBe(4)
    // CONFIRMED is the only link status that counts as a synthesis event.
    expect(prisma.link.count).toHaveBeenCalledWith({
      where: { userId: 'u1', status: LinkStatus.CONFIRMED },
    })
  })

  it('counts only forward transitions in the window', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
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
    withEmptyDefaults(prisma)

    await service.forUser('u1')

    const arg = prisma.conceptStateTransition.findMany.mock.calls[0][0]
    expect(arg.where.userId).toBe('u1')
    expect(arg.where.createdAt.gte).toBeInstanceOf(Date)
  })

  it('computes the compression-quality trend: sharper = latest shorter than first', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    // Two revisited concepts (≥2 articulations each) ordered oldest-first.
    // c1: first long (10), latest short (4) → sharper.
    // c2: first short (3), latest long (9) → not sharper.
    // c3: only one articulation → not revisited, ignored.
    prisma.articulation.findMany.mockResolvedValue([
      {
        conceptId: 'c1',
        body: 'a'.repeat(10),
        createdAt: new Date('2026-01-01'),
      },
      {
        conceptId: 'c1',
        body: 'a'.repeat(4),
        createdAt: new Date('2026-02-01'),
      },
      {
        conceptId: 'c2',
        body: 'a'.repeat(3),
        createdAt: new Date('2026-01-01'),
      },
      {
        conceptId: 'c2',
        body: 'a'.repeat(9),
        createdAt: new Date('2026-02-01'),
      },
      {
        conceptId: 'c3',
        body: 'a'.repeat(5),
        createdAt: new Date('2026-01-01'),
      },
    ])

    const result = await service.forUser('u1')

    expect(result.compressionQualityTrend.revisitedConcepts).toBe(2)
    expect(result.compressionQualityTrend.sharperShare).toBe(0.5)
  })

  it('returns a null sharperShare when no concept was re-articulated', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    prisma.articulation.findMany.mockResolvedValue([
      { conceptId: 'c1', body: 'only one', createdAt: new Date('2026-01-01') },
    ])

    const result = await service.forUser('u1')

    expect(result.compressionQualityTrend.revisitedConcepts).toBe(0)
    expect(result.compressionQualityTrend.sharperShare).toBeNull()
  })

  it('counts transfer signals: an incoming CONFIRMED link from a later concept', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    prisma.link.findMany.mockResolvedValue([
      // target created earlier than source → transfer (counts once).
      {
        targetConceptId: 't1',
        sourceConcept: { createdAt: new Date('2026-03-01') },
        targetConcept: { createdAt: new Date('2026-01-01') },
      },
      // source created earlier than target → not a transfer signal.
      {
        targetConceptId: 't2',
        sourceConcept: { createdAt: new Date('2026-01-01') },
        targetConcept: { createdAt: new Date('2026-03-01') },
      },
    ])

    const result = await service.forUser('u1')

    expect(result.transferSignals).toBe(1)
    // Scoped to the user's CONFIRMED links.
    expect(prisma.link.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', status: LinkStatus.CONFIRMED },
      }),
    )
  })

  it('computes advancedShare = (defended + internalized) / live concepts', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    // concept.count order: [retained, internalized, defended,
    // advancedConceptCount, gradedConceptScope].
    prisma.concept.count
      .mockResolvedValueOnce(0) // retained
      .mockResolvedValueOnce(0) // internalized
      .mockResolvedValueOnce(0) // defended
      .mockResolvedValueOnce(3) // defended + internalized
      .mockResolvedValueOnce(12) // live concepts (non-INBOX, non-ARCHIVED)

    const result = await service.forUser('u1')

    expect(result.advancedShare).toBe(0.25)
  })

  it('returns a null advancedShare when there are no live concepts', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    prisma.concept.count
      .mockResolvedValueOnce(0) // retained
      .mockResolvedValueOnce(0) // internalized
      .mockResolvedValueOnce(0) // defended
      .mockResolvedValueOnce(0) // defended + internalized
      .mockResolvedValueOnce(0) // live concepts

    const result = await service.forUser('u1')

    expect(result.advancedShare).toBeNull()
  })

  it('counts decay recovery from REACTIVATED transitions', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    prisma.conceptStateTransition.count.mockResolvedValue(4)

    const result = await service.forUser('u1')

    expect(result.decayRecovery).toBe(4)
    expect(prisma.conceptStateTransition.count).toHaveBeenCalledWith({
      where: { userId: 'u1', trigger: StateTrigger.REACTIVATED },
    })
  })

  it('buckets the retrieval trend by week over the trailing window', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    // This week: 1 pass + 1 fail → rate 0.5. Three weeks ago: 1 pass → 1.0.
    prisma.retrievalEvent.findMany.mockResolvedValue([
      { score: 5, createdAt: new Date(now - 1 * day) },
      { score: 1, createdAt: new Date(now - 2 * day) },
      { score: 4, createdAt: new Date(now - 21 * day) },
    ])

    const result = await service.forUser('u1')

    // Eight weekly buckets, oldest first.
    expect(result.retrievalTrend).toHaveLength(8)
    // The most recent bucket holds the two recent events: 1 of 2 passed.
    expect(result.retrievalTrend[7].rate).toBe(0.5)
    // A bucket with no graded events reports null, not zero.
    expect(result.retrievalTrend[0].rate).toBeNull()
    // The week-3-ago bucket has a single pass.
    const withData = result.retrievalTrend.filter((p) => p.rate !== null)
    expect(withData.some((p) => p.rate === 1)).toBe(true)
    // Each point carries an ISO weekStart.
    expect(typeof result.retrievalTrend[0].weekStart).toBe('string')
  })

  it('provides a one-line explanation for each headline metric', async () => {
    const { service, prisma } = makeService()
    withEmptyDefaults(prisma)

    const result = await service.forUser('u1')

    const keys = result.explanations.map((e) => e.key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'retrievalSuccessRate',
        'connectionsValidated',
        'compressionQualityTrend',
        'transferSignals',
        'advancedShare',
        'decayRecovery',
        'forwardTransitions30d',
      ]),
    )
    for (const e of result.explanations) {
      expect(e.explanation.length).toBeGreaterThan(0)
      expect(typeof e.label).toBe('string')
    }
  })
})
