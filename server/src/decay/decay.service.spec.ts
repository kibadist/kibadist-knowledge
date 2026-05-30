import { StateTrigger } from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { HALF_LIFE_DAYS } from './decay'
import { DecayService } from './decay.service'

const DAY_MS = 24 * 60 * 60 * 1000

function makeService() {
  const prisma = {
    concept: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }
  const conceptState = {
    transition: jest.fn().mockResolvedValue('DORMANT'),
  }
  const service = new DecayService(prisma as never, conceptState as never)
  return { service, prisma, conceptState }
}

describe('DecayService.refresh', () => {
  it('sets activation to 1 and re-stamps activationAt, scoped to {id, userId}', async () => {
    const { service, prisma } = makeService()
    const before = Date.now()

    await service.refresh('u1', 'c1')

    const call = prisma.concept.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'c1', userId: 'u1' })
    expect(call.data.activation).toBe(1)
    expect(call.data.activationAt).toBeInstanceOf(Date)
    expect(call.data.activationAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('uses the transaction client when one is passed', async () => {
    const { service, prisma } = makeService()
    const tx = { concept: { updateMany: jest.fn().mockResolvedValue({}) } }

    await service.refresh('u1', 'c1', tx as never)

    expect(tx.concept.updateMany).toHaveBeenCalled()
    expect(prisma.concept.updateMany).not.toHaveBeenCalled()
  })
})

describe('DecayService.sweep', () => {
  it('moves a stale (old activationAt, low base) concept to DORMANT and leaves a fresh one alone', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      {
        // Stale: full base but untouched for many half-lives → far below floor.
        id: 'stale',
        activation: 1,
        activationAt: new Date(Date.now() - 10 * HALF_LIFE_DAYS * DAY_MS),
        cognitiveState: 'EXPLAINED',
      },
      {
        // Fresh: just stamped → activation ~1, well above the floor.
        id: 'fresh',
        activation: 1,
        activationAt: new Date(),
        cognitiveState: 'RETRIEVED',
      },
    ])

    const moved = await service.sweep('u1')

    expect(moved).toBe(1)
    expect(conceptState.transition).toHaveBeenCalledTimes(1)
    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptId: 'stale',
        userId: 'u1',
        to: 'DORMANT',
        trigger: StateTrigger.DECAYED,
      }),
    )
    // The query excludes already-DORMANT and ARCHIVED concepts.
    const where = prisma.concept.findMany.mock.calls[0][0].where
    expect(where.cognitiveState).toEqual({ notIn: ['DORMANT', 'ARCHIVED'] })
  })

  it('does not abort the sweep when one transition fails (best-effort)', async () => {
    const { service, prisma, conceptState } = makeService()
    conceptState.transition.mockRejectedValue(new Error('illegal'))
    prisma.concept.findMany.mockResolvedValue([
      {
        id: 'stale',
        activation: 1,
        activationAt: new Date(Date.now() - 10 * HALF_LIFE_DAYS * DAY_MS),
        cognitiveState: 'EXPLAINED',
      },
    ])

    const moved = await service.sweep('u1')

    expect(moved).toBe(0)
    expect(conceptState.transition).toHaveBeenCalled()
  })
})

describe('DecayService.revive', () => {
  it('refreshes activation and transitions a DORMANT concept to RETRIEVED', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.concept.findFirst.mockResolvedValue({ cognitiveState: 'DORMANT' })
    conceptState.transition.mockResolvedValue('RETRIEVED')

    const state = await service.revive('u1', 'c1')

    // Activation restored.
    const update = prisma.concept.updateMany.mock.calls[0][0]
    expect(update.where).toEqual({ id: 'c1', userId: 'u1' })
    expect(update.data.activation).toBe(1)
    // And reactivated through the state machine.
    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptId: 'c1',
        userId: 'u1',
        to: 'RETRIEVED',
        trigger: StateTrigger.REACTIVATED,
      }),
    )
    expect(state).toBe('RETRIEVED')
  })

  it('refreshes but does not transition a non-DORMANT concept', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.concept.findFirst.mockResolvedValue({ cognitiveState: 'EXPLAINED' })

    const state = await service.revive('u1', 'c1')

    expect(prisma.concept.updateMany).toHaveBeenCalled()
    expect(conceptState.transition).not.toHaveBeenCalled()
    expect(state).toBe('EXPLAINED')
  })

  it('throws NotFound for an unowned (or INBOX) concept and never refreshes', async () => {
    const { service, prisma, conceptState } = makeService()
    prisma.concept.findFirst.mockResolvedValue(null)

    await expect(service.revive('u1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.concept.updateMany).not.toHaveBeenCalled()
    expect(conceptState.transition).not.toHaveBeenCalled()
  })
})
