import { LinkStatus } from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { GraphService } from './graph.service'

function makeService() {
  const prisma = {
    concept: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    link: {
      findMany: jest.fn(),
    },
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

    const graph = await service.getGraph('u1')

    expect(graph.edges.map((e) => e.id)).toEqual(['l1'])
  })

  it('only reads SUGGESTED/CONFIRMED links (REJECTED excluded at the query)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([concept({ id: 'c1' })])
    prisma.link.findMany.mockResolvedValue([])
    prisma.graphNodePosition.findMany.mockResolvedValue([])

    await service.getGraph('u1')

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

    const graph = await service.getGraph('u1')
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
