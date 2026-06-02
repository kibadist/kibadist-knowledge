import { Generator } from '@kibadist/prisma'

import { DomainSuggestionService } from './domain-suggestion.service'

function makeService() {
  const prisma = {
    concept: { findFirst: jest.fn() },
    articulation: { findFirst: jest.fn() },
    domain: { findMany: jest.fn() },
    conceptDomain: { create: jest.fn() },
  }
  const ai = { complete: jest.fn() }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const service = new DomainSuggestionService(
    prisma as never,
    ai as never,
    concepts as never,
  )
  return { service, prisma, ai, concepts }
}

describe('DomainSuggestionService.suggestForConcept', () => {
  it('persists AI suggestions as createdBy AI, userValidated false (provenance)', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      title: 'Raft',
      workspaceId: 'ws1',
    })
    prisma.articulation.findFirst.mockResolvedValue({
      body: 'A consensus algorithm for replicated logs.',
    })
    prisma.domain.findMany.mockResolvedValue([
      { id: 'd0', name: 'Distributed Systems', description: null },
      { id: 'd1', name: 'Cooking', description: null },
    ])
    // The model assigns domain 0 only, with a confidence.
    ai.complete.mockResolvedValue({
      text: '0 | 0.9 | Squarely distributed systems.',
    })
    prisma.conceptDomain.create.mockImplementation(
      ({ data }: { data: unknown }) => Promise.resolve(data),
    )

    const created = await service.suggestForConcept('u1', 'c1')

    expect(prisma.conceptDomain.create).toHaveBeenCalledTimes(1)
    expect(prisma.conceptDomain.create).toHaveBeenCalledWith({
      data: {
        conceptId: 'c1',
        domainId: 'd0',
        confidence: 0.9,
        createdBy: Generator.AI,
        userValidated: false,
      },
    })
    expect(created).toHaveLength(1)
  })

  it('returns [] without calling AI when the workspace has no domains', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      title: 'Raft',
      workspaceId: 'ws1',
    })
    prisma.articulation.findFirst.mockResolvedValue({ body: 'text' })
    prisma.domain.findMany.mockResolvedValue([])

    const created = await service.suggestForConcept('u1', 'c1')

    expect(created).toEqual([])
    expect(ai.complete).not.toHaveBeenCalled()
  })

  it('returns [] (never throws) when the concept has no articulation to classify', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      title: 'Raft',
      workspaceId: 'ws1',
    })
    prisma.articulation.findFirst.mockResolvedValue(null)

    const created = await service.suggestForConcept('u1', 'c1')

    expect(created).toEqual([])
    expect(ai.complete).not.toHaveBeenCalled()
  })

  it('is best-effort: a thrown AI error is swallowed and yields []', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      title: 'Raft',
      workspaceId: 'ws1',
    })
    prisma.articulation.findFirst.mockResolvedValue({ body: 'text' })
    prisma.domain.findMany.mockResolvedValue([
      { id: 'd0', name: 'Distributed Systems', description: null },
    ])
    ai.complete.mockRejectedValue(new Error('provider down'))

    await expect(service.suggestForConcept('u1', 'c1')).resolves.toEqual([])
  })
})
