import {
  CognitiveState,
  Generator,
  RequiredDepth,
  TrackConceptStatus,
} from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { TracksService } from './tracks.service'

function makeService() {
  const prisma = {
    track: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    concept: { findFirst: jest.fn() },
    trackConcept: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
  }
  const service = new TracksService(prisma as never, concepts as never)
  return { service, prisma, concepts }
}

describe('TracksService — per-track depth independence', () => {
  it('the SAME concept in two tracks keeps independent requiredDepth rows', async () => {
    const { service, prisma } = makeService()
    // Both tracks owned, both in ws1; concept c1 in ws1.
    prisma.track.findFirst.mockResolvedValue({ id: 't', workspaceId: 'ws1' })
    prisma.concept.findFirst.mockResolvedValue({ workspaceId: 'ws1' })
    prisma.trackConcept.upsert.mockImplementation(
      ({ create }: { create: unknown }) => Promise.resolve(create),
    )

    const inA = await service.addConcept('u1', 'tA', {
      conceptId: 'c1',
      requiredDepth: RequiredDepth.RECOGNIZE,
    })
    const inB = await service.addConcept('u1', 'tB', {
      conceptId: 'c1',
      requiredDepth: RequiredDepth.TEACH,
    })

    // Two distinct membership rows (composite PK trackId+conceptId), each with
    // its own demand — the concept is shallow in A and deep in B.
    expect(inA).toMatchObject({
      trackId: 'tA',
      conceptId: 'c1',
      requiredDepth: RequiredDepth.RECOGNIZE,
      status: TrackConceptStatus.CANDIDATE,
      createdBy: Generator.USER,
    })
    expect(inB).toMatchObject({
      trackId: 'tB',
      conceptId: 'c1',
      requiredDepth: RequiredDepth.TEACH,
    })
  })

  it('rejects adding a concept from another workspace to a track', async () => {
    const { service, prisma } = makeService()
    prisma.track.findFirst.mockResolvedValue({ id: 't', workspaceId: 'ws1' })
    prisma.concept.findFirst.mockResolvedValue({ workspaceId: 'ws2' })

    await expect(
      service.addConcept('u1', 't', { conceptId: 'c1' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.trackConcept.upsert).not.toHaveBeenCalled()
  })
})

describe('TracksService.listConcepts — derived progress', () => {
  it('derives progress from requiredDepth vs the concept live CognitiveState', async () => {
    const { service, prisma } = makeService()
    prisma.track.findFirst.mockResolvedValue({ id: 't', workspaceId: 'ws1' })
    prisma.trackConcept.findMany.mockResolvedValue([
      {
        trackId: 't',
        conceptId: 'c1',
        requiredDepth: RequiredDepth.EXPLAIN,
        concept: {
          id: 'c1',
          title: 'A',
          cognitiveState: CognitiveState.EXPLAINED,
          status: 'PERMANENT',
        },
      },
      {
        trackId: 't',
        conceptId: 'c2',
        requiredDepth: RequiredDepth.TEACH,
        concept: {
          id: 'c2',
          title: 'B',
          cognitiveState: CognitiveState.EXPLAINED,
          status: 'PERMANENT',
        },
      },
    ])

    const rows = await service.listConcepts('u1', 't')

    // c1: EXPLAINED meets EXPLAIN. c2: EXPLAINED does NOT meet TEACH.
    expect(rows[0].progress.met).toBe(true)
    expect(rows[1].progress.met).toBe(false)
    // Progress is never persisted — it isn't part of the stored row.
    expect(rows[0]).not.toHaveProperty('mastery')
  })
})

describe('TracksService.updateConcept — transitions + reorder persist', () => {
  it('persists a status transition and a new orderIndex', async () => {
    const { service, prisma } = makeService()
    prisma.track.findFirst.mockResolvedValue({ id: 't', workspaceId: 'ws1' })
    prisma.trackConcept.findUnique.mockResolvedValue({
      trackId: 't',
      conceptId: 'c1',
    })
    prisma.trackConcept.update.mockImplementation(
      ({ data }: { data: unknown }) => Promise.resolve(data),
    )

    await service.updateConcept('u1', 't', 'c1', {
      status: TrackConceptStatus.ACCEPTED,
      orderIndex: 3,
    })

    expect(prisma.trackConcept.update).toHaveBeenCalledWith({
      where: { trackId_conceptId: { trackId: 't', conceptId: 'c1' } },
      data: {
        status: TrackConceptStatus.ACCEPTED,
        importance: undefined,
        requiredDepth: undefined,
        orderIndex: 3,
      },
    })
  })

  it('404s when the membership is absent', async () => {
    const { service, prisma } = makeService()
    prisma.track.findFirst.mockResolvedValue({ id: 't', workspaceId: 'ws1' })
    prisma.trackConcept.findUnique.mockResolvedValue(null)

    await expect(
      service.updateConcept('u1', 't', 'c1', {
        status: TrackConceptStatus.SKIPPED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.trackConcept.update).not.toHaveBeenCalled()
  })
})

describe('TracksService.remove', () => {
  it('deletes the track only — concepts survive (cascade drops memberships)', async () => {
    const { service, prisma } = makeService()
    prisma.track.findFirst.mockResolvedValue({ id: 't', workspaceId: 'ws1' })
    prisma.track.delete.mockResolvedValue({ id: 't' })

    await service.remove('u1', 't')

    expect(prisma.track.delete).toHaveBeenCalledWith({ where: { id: 't' } })
  })

  it('rejects deleting a track the user does not own', async () => {
    const { service, prisma } = makeService()
    prisma.track.findFirst.mockResolvedValue(null)

    await expect(service.remove('u1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.track.delete).not.toHaveBeenCalled()
  })
})

describe('TracksService.enrollPromotedConcept (DET-240 track-first onboarding)', () => {
  it('enrolls a concept with a valid targetTrackId as an AI CANDIDATE', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      targetTrackId: 't1',
      workspaceId: 'ws1',
    })
    prisma.track.findFirst.mockResolvedValue({ id: 't1' })
    prisma.trackConcept.upsert.mockResolvedValue({
      trackId: 't1',
      conceptId: 'c1',
    })

    const trackId = await service.enrollPromotedConcept('u1', 'c1')

    expect(trackId).toBe('t1')
    expect(prisma.trackConcept.upsert).toHaveBeenCalledWith({
      where: { trackId_conceptId: { trackId: 't1', conceptId: 'c1' } },
      create: {
        trackId: 't1',
        conceptId: 'c1',
        status: TrackConceptStatus.CANDIDATE,
        createdBy: Generator.AI,
      },
      // Never clobbers an existing membership.
      update: {},
    })
  })

  it('is a no-op when the concept has no target track', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      targetTrackId: null,
      workspaceId: 'ws1',
    })

    const trackId = await service.enrollPromotedConcept('u1', 'c1')

    expect(trackId).toBeNull()
    expect(prisma.trackConcept.upsert).not.toHaveBeenCalled()
  })

  it('is a no-op when the target track no longer exists / is cross-workspace', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      targetTrackId: 't-gone',
      workspaceId: 'ws1',
    })
    prisma.track.findFirst.mockResolvedValue(null)

    const trackId = await service.enrollPromotedConcept('u1', 'c1')

    expect(trackId).toBeNull()
    expect(prisma.trackConcept.upsert).not.toHaveBeenCalled()
  })
})
