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
  const conceptState = {}
  const decay = {}
  const service = new ConceptsService(
    prisma as never,
    conceptState as never,
    decay as never,
  )
  return { service, prisma }
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
