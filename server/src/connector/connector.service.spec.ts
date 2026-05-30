import { LinkRelation, LinkStatus, QuestionActor } from '@kibadist/prisma'

import { ConnectorService } from './connector.service'

function makeService() {
  const prisma = {
    link: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    concept: {
      findMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ title: 'New concept' }),
    },
    articulation: { findFirst: jest.fn() },
  }
  const ai = { complete: jest.fn() }
  const search = { searchArticulations: jest.fn() }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const service = new ConnectorService(
    prisma as never,
    ai as never,
    search as never,
    concepts as never,
  )
  return { service, prisma, ai, search, concepts }
}

/** Two neighbor articulations on two distinct concepts. */
const MATCHES = [
  { id: 'a1', conceptId: 't1', body: 'neighbor one body', similarity: 0.9 },
  { id: 'a2', conceptId: 't2', body: 'neighbor two body', similarity: 0.8 },
]

describe('ConnectorService.proposeEphemeral', () => {
  it('returns typed proposals and persists nothing', async () => {
    const { service, prisma, ai, search } = makeService()
    search.searchArticulations.mockResolvedValue(MATCHES)
    prisma.concept.findMany.mockResolvedValue([
      { id: 't1', title: 'Target one' },
      { id: 't2', title: 'Target two' },
    ])
    ai.complete.mockResolvedValue({
      text: '0 | supports | It backs up the first.\n1 | contradiction | It conflicts with the second.',
      model: 'test',
    })

    const out = await service.proposeEphemeral('u1', 'c1', 'my articulation')

    expect(out).toEqual([
      {
        targetConceptId: 't1',
        title: 'Target one',
        relationKind: LinkRelation.SUPPORTS,
        rationale: 'It backs up the first.',
        similarity: 0.9,
      },
      {
        targetConceptId: 't2',
        title: 'Target two',
        relationKind: LinkRelation.CONTRADICTION,
        rationale: 'It conflicts with the second.',
        similarity: 0.8,
      },
    ])
    // The DET-187 invariant: ephemeral proposals never write a Link row.
    expect(prisma.link.create).not.toHaveBeenCalled()
  })

  it('excludes self and pairs with a remembered CONFIRMED/REJECTED decision', async () => {
    const { service, prisma, ai, search } = makeService()
    // Include a self-match (c1) plus two real neighbors.
    search.searchArticulations.mockResolvedValue([
      { id: 'self', conceptId: 'c1', body: 'self', similarity: 0.99 },
      ...MATCHES,
    ])
    // t1 already has a remembered decision (CONFIRMED or REJECTED) → excluded.
    prisma.link.findMany.mockResolvedValue([{ targetConceptId: 't1' }])
    prisma.concept.findMany.mockResolvedValue([
      { id: 't2', title: 'Target two' },
    ])
    ai.complete.mockResolvedValue({
      text: '0 | refines | only the surviving candidate',
      model: 'test',
    })

    const out = await service.proposeEphemeral('u1', 'c1', 'art')

    expect(out).toHaveLength(1)
    expect(out[0].targetConceptId).toBe('t2')
    // The remembered-decision query filtered on CONFIRMED + REJECTED.
    const where = prisma.link.findMany.mock.calls[0][0].where
    expect(where.status.in).toEqual([LinkStatus.CONFIRMED, LinkStatus.REJECTED])
    // Self was never offered as a candidate.
    const conceptIds = prisma.concept.findMany.mock.calls[0][0].where.id.in
    expect(conceptIds).not.toContain('c1')
  })

  it('degrades to [] when the search fails', async () => {
    const { service, search, ai } = makeService()
    search.searchArticulations.mockRejectedValue(new Error('embeddings down'))
    const out = await service.proposeEphemeral('u1', 'c1', 'art')
    expect(out).toEqual([])
    expect(ai.complete).not.toHaveBeenCalled()
  })

  it('degrades to [] when the AI classification fails', async () => {
    const { service, prisma, search, ai } = makeService()
    search.searchArticulations.mockResolvedValue(MATCHES)
    prisma.concept.findMany.mockResolvedValue([
      { id: 't1', title: 'Target one' },
      { id: 't2', title: 'Target two' },
    ])
    ai.complete.mockRejectedValue(new Error('provider down'))
    const out = await service.proposeEphemeral('u1', 'c1', 'art')
    expect(out).toEqual([])
  })

  it('returns [] when there are no neighbors', async () => {
    const { service, search, ai } = makeService()
    search.searchArticulations.mockResolvedValue([])
    const out = await service.proposeEphemeral('u1', 'c1', 'art')
    expect(out).toEqual([])
    expect(ai.complete).not.toHaveBeenCalled()
  })
})

describe('ConnectorService.proposeAndPersist', () => {
  it('upserts each proposal as a SUGGESTED AI link after promotion', async () => {
    const { service, prisma, ai, search, concepts } = makeService()
    prisma.articulation.findFirst.mockResolvedValue({ body: 'latest body' })
    search.searchArticulations.mockResolvedValue(MATCHES)
    prisma.concept.findMany.mockResolvedValue([
      { id: 't1', title: 'Target one' },
      { id: 't2', title: 'Target two' },
    ])
    ai.complete.mockResolvedValue({
      text: '0 | supports | a\n1 | refines | b',
      model: 'test',
    })

    await service.proposeAndPersist('u1', 'c1')

    expect(concepts.assertOwnedNonInbox).toHaveBeenCalledWith('u1', 'c1')
    expect(prisma.link.create).toHaveBeenCalledTimes(2)
    const first = prisma.link.create.mock.calls[0][0].data
    expect(first.status).toBe(LinkStatus.SUGGESTED)
    expect(first.proposedBy).toBe(QuestionActor.AI)
    expect(first.relationKind).toBe(LinkRelation.SUPPORTS)
    expect(first.sourceConceptId).toBe('c1')
  })

  it('does nothing when the concept has no articulation', async () => {
    const { service, prisma, ai } = makeService()
    prisma.articulation.findFirst.mockResolvedValue(null)
    await service.proposeAndPersist('u1', 'c1')
    expect(ai.complete).not.toHaveBeenCalled()
    expect(prisma.link.create).not.toHaveBeenCalled()
  })

  it('swallows a failure instead of throwing (non-blocking background pass)', async () => {
    const { service, prisma } = makeService()
    prisma.articulation.findFirst.mockRejectedValue(new Error('db blip'))
    await expect(service.proposeAndPersist('u1', 'c1')).resolves.toBeUndefined()
  })
})
