import { GraphScope } from '@kibadist/prisma'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { GraphViewsService } from './graph-views.service'

function makeService() {
  const prisma = {
    graphView: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  }
  const graph = { getScopedGraph: jest.fn() }
  const service = new GraphViewsService(prisma as never, graph as never)
  return { service, prisma, graph }
}

describe('GraphViewsService.create', () => {
  it('saves a WORKSPACE view (no target required)', async () => {
    const { service, prisma } = makeService()
    prisma.graphView.create.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve(data),
    )

    const view = await service.create('ws1', {
      name: 'Everything',
      scope: GraphScope.WORKSPACE,
    })

    expect(view).toMatchObject({
      workspaceId: 'ws1',
      scope: GraphScope.WORKSPACE,
    })
  })

  it('rejects a TRACK view with no trackId', async () => {
    const { service, prisma } = makeService()
    await expect(
      service.create('ws1', { name: 'T', scope: GraphScope.TRACK }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.graphView.create).not.toHaveBeenCalled()
  })

  it('rejects an MVP-out-of-scope view (REVIEW)', async () => {
    const { service } = makeService()
    await expect(
      service.create('ws1', { name: 'R', scope: GraphScope.REVIEW }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('GraphViewsService.resolve', () => {
  it('resolves a saved view live via the scoped resolver with its stored target', async () => {
    const { service, prisma, graph } = makeService()
    prisma.graphView.findFirst.mockResolvedValue({
      id: 'v1',
      workspaceId: 'ws1',
      scope: GraphScope.DOMAIN,
      domainId: 'd1',
      sourceConceptId: null,
      trackId: null,
      centerConceptId: null,
    })
    graph.getScopedGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      positions: [],
    })

    await service.resolve('u1', 'v1')

    // Ownership is checked through the workspace owner, then delegated live.
    expect(prisma.graphView.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', workspace: { ownerUserId: 'u1' } },
    })
    expect(graph.getScopedGraph).toHaveBeenCalledWith('u1', 'ws1', {
      scope: GraphScope.DOMAIN,
      domainId: 'd1',
      sourceConceptId: undefined,
      trackId: undefined,
      centerConceptId: undefined,
    })
  })

  it('404s when the view is not owned', async () => {
    const { service, prisma } = makeService()
    prisma.graphView.findFirst.mockResolvedValue(null)
    await expect(service.resolve('u1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})

describe('GraphViewsService.remove', () => {
  it('deletes only the view (never concepts/links/positions)', async () => {
    const { service, prisma } = makeService()
    prisma.graphView.findFirst.mockResolvedValue({
      id: 'v1',
      workspaceId: 'ws1',
    })
    prisma.graphView.delete.mockResolvedValue({ id: 'v1' })

    await service.remove('u1', 'v1')

    expect(prisma.graphView.delete).toHaveBeenCalledWith({
      where: { id: 'v1' },
    })
  })
})
