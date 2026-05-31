import { Certainty } from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { ConceptsService } from './concepts.service'

function makeService() {
  const prisma = {
    concept: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'c1' }),
    },
  }
  const conceptState = { history: jest.fn().mockResolvedValue([]) }
  const decay = {}
  const service = new ConceptsService(
    prisma as never,
    conceptState as never,
    decay as never,
  )
  return { service, prisma, conceptState }
}

describe('ConceptsService.setCertainty', () => {
  it('asserts ownership of a non-inbox concept, then updates its certainty', async () => {
    const { service, prisma } = makeService()
    // assertOwnedNonInbox passes.
    prisma.concept.findFirst.mockResolvedValue({ id: 'c1' })

    await service.setCertainty('u1', 'c1', Certainty.UNCERTAIN)

    // The ownership gate excludes INBOX captures.
    const where = prisma.concept.findFirst.mock.calls[0][0].where
    expect(where).toEqual({
      id: 'c1',
      userId: 'u1',
      status: { not: 'INBOX' },
    })
    // And the certainty is written.
    expect(prisma.concept.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { certainty: Certainty.UNCERTAIN },
    })
  })

  it('rejects an inbox (or unowned) concept and never updates', async () => {
    const { service, prisma } = makeService()
    // assertOwnedNonInbox finds nothing (INBOX or not owned).
    prisma.concept.findFirst.mockResolvedValue(null)

    await expect(
      service.setCertainty('u1', 'inbox', Certainty.TENTATIVE),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.concept.update).not.toHaveBeenCalled()
  })
})

describe('ConceptsService.findOne', () => {
  // The minimal concept row findOne reads, with the activation fields the
  // current-activation computation needs and an empty relation set we override.
  const baseConcept = {
    id: 'c1',
    activation: 1,
    activationAt: new Date(),
    articulations: [],
    outgoingLinks: [],
    incomingLinks: [],
    retrievalEvents: [],
    reflections: [],
  }

  it('returns evidenceDensity equal to the number of articulations', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      ...baseConcept,
      // Evidence density (DET-199) is a cheap proxy: the count of the user's
      // own supporting compressions backing the concept.
      articulations: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
    })

    const result = await service.findOne('u1', 'c1')

    expect(result.evidenceDensity).toBe(3)
  })

  it('reports zero evidence density when there are no articulations', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      ...baseConcept,
      articulations: [],
    })

    const result = await service.findOne('u1', 'c1')

    expect(result.evidenceDensity).toBe(0)
  })
})
