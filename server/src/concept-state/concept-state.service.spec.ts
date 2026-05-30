import { CognitiveState, StateTrigger } from '@kibadist/prisma'
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'

import { ConceptStateService } from './concept-state.service'

function makeService() {
  const prisma = {
    // updateMany is the conditional, concurrency-safe state write (keyed on the
    // prior state); it defaults to a winning update (count 1).
    concept: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    conceptStateTransition: { create: jest.fn(), findMany: jest.fn() },
    // The callback form: run the transaction body directly against the same mock
    // client, mirroring an interactive transaction. Assigned after the object so
    // it can reference `prisma` without a self-referential type.
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  )
  const service = new ConceptStateService(prisma as never)
  return { service, prisma }
}

describe('ConceptStateService.transition', () => {
  it('updates the state and writes a transition row', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      cognitiveState: CognitiveState.SEEN,
    })

    const result = await service.transition({
      conceptId: 'c1',
      userId: 'u1',
      to: CognitiveState.PARSED,
      trigger: StateTrigger.INTAKE_PARSED,
    })

    expect(result).toBe(CognitiveState.PARSED)
    expect(prisma.concept.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', userId: 'u1', cognitiveState: CognitiveState.SEEN },
      data: { cognitiveState: CognitiveState.PARSED },
    })
    expect(prisma.conceptStateTransition.create).toHaveBeenCalledWith({
      data: {
        conceptId: 'c1',
        userId: 'u1',
        from: CognitiveState.SEEN,
        to: CognitiveState.PARSED,
        trigger: StateTrigger.INTAKE_PARSED,
        note: undefined,
      },
    })
  })

  it('is a no-op when from === to (no row written)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      cognitiveState: CognitiveState.SEEN,
    })

    const result = await service.transition({
      conceptId: 'c1',
      userId: 'u1',
      to: CognitiveState.SEEN,
      trigger: StateTrigger.CAPTURE,
    })

    expect(result).toBe(CognitiveState.SEEN)
    expect(prisma.concept.updateMany).not.toHaveBeenCalled()
    expect(prisma.conceptStateTransition.create).not.toHaveBeenCalled()
  })

  it('throws BadRequestException on an illegal transition', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      cognitiveState: CognitiveState.SEEN,
    })

    await expect(
      service.transition({
        conceptId: 'c1',
        userId: 'u1',
        to: CognitiveState.INTERNALIZED,
        trigger: StateTrigger.INTERNALIZED,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.concept.updateMany).not.toHaveBeenCalled()
    expect(prisma.conceptStateTransition.create).not.toHaveBeenCalled()
  })

  it('throws ConflictException and writes no row when a concurrent transition won the race', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      cognitiveState: CognitiveState.SEEN,
    })
    // Another transition moved the concept between our read and write.
    prisma.concept.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      service.transition({
        conceptId: 'c1',
        userId: 'u1',
        to: CognitiveState.PARSED,
        trigger: StateTrigger.INTAKE_PARSED,
      }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.conceptStateTransition.create).not.toHaveBeenCalled()
  })

  it('throws NotFoundException when the concept is not owned', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue(null)

    await expect(
      service.transition({
        conceptId: 'c1',
        userId: 'u1',
        to: CognitiveState.PARSED,
        trigger: StateTrigger.INTAKE_PARSED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('ConceptStateService.recordCapture', () => {
  it('writes a null → SEEN row', async () => {
    const { service, prisma } = makeService()

    await service.recordCapture('c1', 'u1')

    expect(prisma.conceptStateTransition.create).toHaveBeenCalledWith({
      data: {
        conceptId: 'c1',
        userId: 'u1',
        from: null,
        to: 'SEEN',
        trigger: StateTrigger.CAPTURE,
        note: undefined,
      },
    })
  })
})
