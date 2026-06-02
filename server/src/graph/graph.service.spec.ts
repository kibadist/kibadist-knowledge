import { LinkStatus } from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { GraphService } from './graph.service'

function makeService() {
  const prisma = {
    concept: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    link: {
      findMany: jest.fn(),
    },
    track: { findFirst: jest.fn() },
    domain: { findFirst: jest.fn() },
    trackConcept: { findMany: jest.fn() },
    conceptDomain: { findMany: jest.fn() },
    graphNodePosition: {
      findMany: jest.fn(),
      // Returns its args so the array handed to $transaction is inspectable.
      upsert: jest.fn((args: unknown) => args),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  }
  const service = new GraphService(prisma as never)
  return { service, prisma }
}

// A minimal earned-concept row with the activation fields currentActivation reads.
function concept(over: Record<string, unknown>) {
  return {
    id: 'c1',
    title: 'C1',
    summary: null,
    cognitiveState: 'RETRIEVED',
    status: 'PERMANENT',
    certainty: 'ASSERTED',
    activation: 1,
    activationAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    livingConcept: null,
    ...over,
  }
}

describe('GraphService.getGraph', () => {
  it('drops edges whose endpoint is not in the returned node set', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      concept({ id: 'c1' }),
      concept({ id: 'c2' }),
    ])
    prisma.link.findMany.mockResolvedValue([
      // Both endpoints present → kept.
      {
        id: 'l1',
        sourceConceptId: 'c1',
        targetConceptId: 'c2',
        relationKind: 'SUPPORTS',
        relation: null,
        status: LinkStatus.CONFIRMED,
        proposedBy: 'AI',
        rationale: null,
      },
      // Target is an INBOX/absent concept → dropped.
      {
        id: 'l2',
        sourceConceptId: 'c1',
        targetConceptId: 'gone',
        relationKind: 'SUPPORTS',
        relation: null,
        status: LinkStatus.SUGGESTED,
        proposedBy: 'AI',
        rationale: null,
      },
    ])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    const graph = await service.getGraph('u1', 'ws1')

    expect(graph.edges.map((e) => e.id)).toEqual(['l1'])
  })

  it('only reads SUGGESTED/CONFIRMED links (REJECTED excluded at the query)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([concept({ id: 'c1' })])
    prisma.link.findMany.mockResolvedValue([])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    await service.getGraph('u1', 'ws1')

    const where = prisma.link.findMany.mock.calls[0][0].where
    expect(where.status).toEqual({
      in: [LinkStatus.SUGGESTED, LinkStatus.CONFIRMED],
    })
  })

  it('maps hasPersona/personaStatus and treats an ARCHIVED persona as absent', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      concept({ id: 'draft', livingConcept: { id: 'p1', status: 'DRAFT' } }),
      concept({ id: 'none', livingConcept: null }),
      concept({
        id: 'retired',
        livingConcept: { id: 'p2', status: 'ARCHIVED' },
      }),
    ])
    prisma.link.findMany.mockResolvedValue([])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    const graph = await service.getGraph('u1', 'ws1')
    const byId = new Map(graph.nodes.map((n) => [n.id, n]))

    expect(byId.get('draft')).toMatchObject({
      hasPersona: true,
      personaStatus: 'DRAFT',
    })
    expect(byId.get('none')).toMatchObject({
      hasPersona: false,
      personaStatus: null,
    })
    // ARCHIVED persona must not show as a Living node (DET-227).
    expect(byId.get('retired')).toMatchObject({
      hasPersona: false,
      personaStatus: null,
    })
  })
})

describe('GraphService.getScopedGraph — scope resolution', () => {
  it('WORKSPACE scope applies no id filter (whole workspace)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([concept({ id: 'c1' })])
    prisma.link.findMany.mockResolvedValue([])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    await service.getScopedGraph('u1', 'ws1', { scope: 'WORKSPACE' as never })

    const where = prisma.concept.findMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('id')
    expect(where).toMatchObject({
      workspaceId: 'ws1',
      status: { not: 'INBOX' },
    })
  })

  it('TRACK scope restricts nodes to the track’s concept ids', async () => {
    const { service, prisma } = makeService()
    prisma.track.findFirst.mockResolvedValue({ id: 't1' })
    prisma.trackConcept.findMany.mockResolvedValue([
      { conceptId: 'c1' },
      { conceptId: 'c2' },
    ])
    prisma.concept.findMany.mockResolvedValue([concept({ id: 'c1' })])
    prisma.link.findMany.mockResolvedValue([])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    await service.getScopedGraph('u1', 'ws1', {
      scope: 'TRACK' as never,
      trackId: 't1',
    })

    // Ownership of the track is checked through the workspace owner.
    expect(prisma.track.findFirst).toHaveBeenCalledWith({
      where: { id: 't1', workspaceId: 'ws1', workspace: { ownerUserId: 'u1' } },
      select: { id: true },
    })
    expect(prisma.concept.findMany.mock.calls[0][0].where.id).toEqual({
      in: ['c1', 'c2'],
    })
  })

  it('DOMAIN scope restricts nodes to the domain’s concept ids', async () => {
    const { service, prisma } = makeService()
    prisma.domain.findFirst.mockResolvedValue({ id: 'd1' })
    prisma.conceptDomain.findMany.mockResolvedValue([{ conceptId: 'c9' }])
    prisma.concept.findMany.mockResolvedValue([concept({ id: 'c9' })])
    prisma.link.findMany.mockResolvedValue([])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    await service.getScopedGraph('u1', 'ws1', {
      scope: 'DOMAIN' as never,
      domainId: 'd1',
    })

    expect(prisma.concept.findMany.mock.calls[0][0].where.id).toEqual({
      in: ['c9'],
    })
  })

  it('CONCEPT_NEIGHBORHOOD expands the center by its linked neighbors', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({ id: 'center' })
    // One hop: center links to n1 and n2.
    prisma.link.findMany
      .mockResolvedValueOnce([
        { sourceConceptId: 'center', targetConceptId: 'n1' },
        { sourceConceptId: 'n2', targetConceptId: 'center' },
      ])
      // The edge query inside graph assembly.
      .mockResolvedValueOnce([])
    prisma.concept.findMany.mockResolvedValue([concept({ id: 'center' })])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    await service.getScopedGraph('u1', 'ws1', {
      scope: 'CONCEPT_NEIGHBORHOOD' as never,
      centerConceptId: 'center',
      hops: 1,
    })

    const idFilter = prisma.concept.findMany.mock.calls[0][0].where.id.in
    expect(new Set(idFilter)).toEqual(new Set(['center', 'n1', 'n2']))
  })

  it('rejects a targeted scope missing its target', async () => {
    const { service } = makeService()
    await expect(
      service.getScopedGraph('u1', 'ws1', { scope: 'TRACK' as never }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects MVP-out-of-scope scopes (MISCONCEPTION/REVIEW)', async () => {
    const { service } = makeService()
    await expect(
      service.getScopedGraph('u1', 'ws1', { scope: 'REVIEW' as never }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('GraphService.savePositions', () => {
  it('de-dupes a batch by conceptId (last position wins)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.count.mockResolvedValue(1)

    const result = await service.savePositions('u1', {
      positions: [
        { conceptId: 'c1', x: 1, y: 1 },
        { conceptId: 'c1', x: 9, y: 9 },
      ],
    })

    expect(result).toEqual({ saved: 1 })
    expect(prisma.graphNodePosition.upsert).toHaveBeenCalledTimes(1)
    const arg = prisma.graphNodePosition.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(arg.create).toMatchObject({ conceptId: 'c1', x: 9, y: 9 })
    expect(arg.update).toMatchObject({ x: 9, y: 9 })
    // `locked` is deferred (DET-226) — never written.
    expect(arg.create).not.toHaveProperty('locked')
    expect(arg.update).not.toHaveProperty('locked')
  })

  it('checks ownership of earned (non-INBOX) concepts in one batched count', async () => {
    const { service, prisma } = makeService()
    prisma.concept.count.mockResolvedValue(1)

    await service.savePositions('u1', {
      positions: [{ conceptId: 'c1', x: 0, y: 0 }],
    })

    expect(prisma.concept.count).toHaveBeenCalledWith({
      where: { id: { in: ['c1'] }, userId: 'u1', status: { not: 'INBOX' } },
    })
  })

  it('rejects and persists nothing when a concept in the batch is not owned/earned', async () => {
    const { service, prisma } = makeService()
    // A bogus id makes the owned count fall short of the unique-id count.
    prisma.concept.count.mockResolvedValue(1)

    await expect(
      service.savePositions('u1', {
        positions: [
          { conceptId: 'c1', x: 0, y: 0 },
          { conceptId: 'bogus', x: 0, y: 0 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.graphNodePosition.upsert).not.toHaveBeenCalled()
  })
})
