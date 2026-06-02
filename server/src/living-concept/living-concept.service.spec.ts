import { Generator, LivingConceptStatus } from '@kibadist/prisma'

import { LivingConceptService } from './living-concept.service'

function makeService() {
  const prisma = {
    livingConcept: {
      findUnique: jest.fn(),
      create: jest.fn((args: { data: unknown }) => ({
        id: 'lc1',
        ...(args.data as object),
      })),
      update: jest.fn(),
    },
    concept: {
      findFirst: jest.fn().mockResolvedValue({
        title: 'React State',
        summary: 'state summary',
      }),
    },
    articulation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const ai = { complete: jest.fn() }
  const service = new LivingConceptService(
    prisma as never,
    concepts as never,
    ai as never,
  )
  return { service, prisma, concepts, ai }
}

const AI_DRAFT = {
  personaName: 'Reducer',
  personaSummary: 'I fold actions into the next state, deterministically.',
  voice: 'sober, exact',
  coreMetaphor: 'an accountant posting entries to a ledger',
  metaphorBreaks:
    'a ledger never rewrites past entries; a reducer returns new state',
}

describe('LivingConceptService.create — seeding', () => {
  it('tags an AI-seeded persona createdBy AI', async () => {
    const { service, prisma, ai } = makeService()
    prisma.livingConcept.findUnique.mockResolvedValue(null)
    ai.complete.mockResolvedValue({ text: JSON.stringify(AI_DRAFT) })

    await service.create('u1', { conceptId: 'c1' })

    const data = prisma.livingConcept.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      personaName: 'Reducer',
      createdBy: Generator.AI,
    })
  })

  it('falls back to a deterministic stub (createdBy USER) when AI seeding throws', async () => {
    const { service, prisma, ai } = makeService()
    prisma.livingConcept.findUnique.mockResolvedValue(null)
    ai.complete.mockRejectedValue(new Error('model down'))

    await service.create('u1', { conceptId: 'c1' })

    const data = prisma.livingConcept.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      // Stub persona = concept title + summary, tagged USER (hand-authorable).
      personaName: 'React State',
      personaSummary: 'state summary',
      createdBy: Generator.USER,
    })
  })

  it('falls back to the stub when AI returns unusable (non-JSON) output', async () => {
    const { service, prisma, ai } = makeService()
    prisma.livingConcept.findUnique.mockResolvedValue(null)
    ai.complete.mockResolvedValue({ text: 'sorry, I cannot do that' })

    await service.create('u1', { conceptId: 'c1' })

    const data = prisma.livingConcept.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      personaName: 'React State',
      createdBy: Generator.USER,
    })
  })
})

describe('LivingConceptService.create — idempotency & revival', () => {
  it('returns an existing live persona without re-calling AI or creating', async () => {
    const { service, prisma, ai } = makeService()
    const existing = { id: 'lc1', status: LivingConceptStatus.DRAFT }
    prisma.livingConcept.findUnique.mockResolvedValue(existing)

    const result = await service.create('u1', { conceptId: 'c1' })

    expect(result).toBe(existing)
    expect(ai.complete).not.toHaveBeenCalled()
    expect(prisma.livingConcept.create).not.toHaveBeenCalled()
  })

  it('revives an ARCHIVED persona to DRAFT instead of returning the dead row', async () => {
    const { service, prisma, ai } = makeService()
    prisma.livingConcept.findUnique.mockResolvedValue({
      id: 'lc1',
      status: LivingConceptStatus.ARCHIVED,
    })
    prisma.livingConcept.update.mockResolvedValue({
      id: 'lc1',
      status: LivingConceptStatus.DRAFT,
    })

    const result = await service.create('u1', { conceptId: 'c1' })

    expect(prisma.livingConcept.update).toHaveBeenCalledWith({
      where: { id: 'lc1' },
      data: { status: LivingConceptStatus.DRAFT },
    })
    expect(result).toMatchObject({ status: LivingConceptStatus.DRAFT })
    expect(ai.complete).not.toHaveBeenCalled()
    expect(prisma.livingConcept.create).not.toHaveBeenCalled()
  })
})
