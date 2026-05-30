import { ConceptStatus, GateMode, LinkRelation } from '@kibadist/prisma'

import { PromotionService } from './promotion.service'

/**
 * DET-208 invariant: AI-authored reference scaffold can never become canonical
 * knowledge. These tests pin the promotion service's write paths so a future
 * refactor can't quietly route a SourceQuestion answer into an Articulation, and
 * confirm the feed-forward seam is display-only (it cannot prefill articulation).
 */
function makePromotionService() {
  const tx = {
    promotionDraft: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    articulation: { create: jest.fn().mockResolvedValue({ id: 'art1' }) },
    retrievalEvent: { create: jest.fn().mockResolvedValue({}) },
    link: { create: jest.fn().mockResolvedValue({}) },
    concept: { update: jest.fn().mockResolvedValue({}) },
  }
  const prisma = {
    concept: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    promotionDraft: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    // Present so we can assert it is NEVER touched by promotion write paths.
    sourceQuestion: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  }
  const concepts = {
    assertOwnedNonInbox: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue({ id: 'c1', status: 'PERMANENT' }),
  }
  const ai = { complete: jest.fn() }
  const search = {
    searchArticulations: jest.fn().mockResolvedValue([]),
    indexArticulation: jest.fn().mockResolvedValue(undefined),
  }
  const sourceQa = { recentForContext: jest.fn().mockResolvedValue([]) }
  const conceptState = { transition: jest.fn().mockResolvedValue(undefined) }
  const connector = {
    proposeEphemeral: jest.fn().mockResolvedValue([]),
    proposeAndPersist: jest.fn().mockResolvedValue(undefined),
  }
  const service = new PromotionService(
    prisma as never,
    concepts as never,
    ai as never,
    search as never,
    sourceQa as never,
    conceptState as never,
    connector as never,
  )
  return { service, prisma, tx, concepts, sourceQa, conceptState, connector }
}

const INBOX_CONCEPT = {
  id: 'c1',
  title: 'Spaced repetition',
  sourceText: 'source',
}

const USER_ARTICULATION =
  'Spaced repetition schedules reviews at widening intervals to fight forgetting.'

// A fully-passing draft (QUICK root) whose articulation is the user's own words.
const PASSING_DRAFT = {
  conceptId: 'c1',
  userId: 'u1',
  mode: GateMode.QUICK,
  articulation: USER_ARTICULATION,
  connectionsReviewed: true,
  retrievalQuestion: 'Explain it.',
  retrievalResponse: 'I explained it.',
  retrievalScore: 5,
  retrievalPassed: true,
}

describe('DET-208 invariant — scaffold never becomes an Articulation', () => {
  it('commit writes the user articulation, never any scaffold text', async () => {
    const { service, prisma, tx } = makePromotionService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_CONCEPT)
    prisma.promotionDraft.findUnique.mockResolvedValue(PASSING_DRAFT)

    await service.commit('u1', 'c1', {
      mode: GateMode.QUICK,
      isRoot: true,
      connections: [],
    })

    // The only Articulation created uses the draft's user-authored text.
    expect(tx.articulation.create).toHaveBeenCalledTimes(1)
    const created = tx.articulation.create.mock.calls[0][0].data
    expect(created.body).toBe(USER_ARTICULATION)

    // The promotion path never reads or writes the reference-Q&A table.
    expect(prisma.sourceQuestion.create).not.toHaveBeenCalled()
    expect(prisma.sourceQuestion.findMany).not.toHaveBeenCalled()
    expect(prisma.sourceQuestion.update).not.toHaveBeenCalled()
    expect(prisma.sourceQuestion.deleteMany).not.toHaveBeenCalled()
  })

  it('saveArticulation stores exactly the user-supplied body and nothing else', async () => {
    const { service, prisma } = makePromotionService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_CONCEPT)
    prisma.promotionDraft.findUnique.mockResolvedValue({
      ...PASSING_DRAFT,
      articulation: null,
    })

    await service.saveArticulation('u1', 'c1', USER_ARTICULATION)

    // The articulation column is set ONLY from the user's body — there is no
    // parameter or branch that could substitute AI scaffold text.
    const update = prisma.promotionDraft.update.mock.calls[0][0]
    expect(update.data).toEqual({ articulation: USER_ARTICULATION })
    expect(prisma.sourceQuestion.findMany).not.toHaveBeenCalled()
  })
})

describe('DET-191 — a contradiction approved at the gate contests its target', () => {
  it('drives the target concept to CONTESTED after a CONTRADICTION link is committed', async () => {
    const { service, prisma, conceptState } = makePromotionService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_CONCEPT)
    prisma.promotionDraft.findUnique.mockResolvedValue(PASSING_DRAFT)

    await service.commit('u1', 'c1', {
      mode: GateMode.QUICK,
      isRoot: false,
      connections: [
        { targetConceptId: 'other', relationKind: LinkRelation.CONTRADICTION },
      ],
    })

    // The PROMOTION transition for the promoted concept, plus a CONTESTED
    // transition for the contradicted target.
    expect(conceptState.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        conceptId: 'other',
        to: 'CONTESTED',
        trigger: 'CONTRADICTION',
      }),
    )
  })

  it('does not contest the target for a non-contradiction relationship', async () => {
    const { service, prisma, conceptState } = makePromotionService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_CONCEPT)
    prisma.promotionDraft.findUnique.mockResolvedValue(PASSING_DRAFT)

    await service.commit('u1', 'c1', {
      mode: GateMode.QUICK,
      isRoot: false,
      connections: [
        { targetConceptId: 'other', relationKind: LinkRelation.SUPPORTS },
      ],
    })

    expect(conceptState.transition).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'CONTESTED' }),
    )
  })
})

describe('DET-208 seam — reference Q&A is display-only context', () => {
  it('surfaces reference Q&A but never prefills the articulation', async () => {
    const { service, prisma, sourceQa } = makePromotionService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_CONCEPT)
    prisma.promotionDraft.findUnique.mockResolvedValue({
      ...PASSING_DRAFT,
      articulation: null,
    })
    sourceQa.recentForContext.mockResolvedValue([
      { questionText: 'What is forgetting?', answerText: 'The source says…' },
    ])

    const state = await service.getState('u1', 'c1')

    expect(state.referenceQa).toEqual([
      { questionText: 'What is forgetting?', answerText: 'The source says…' },
    ])
    // The canonical articulation stays empty — Q&A context does not seed it.
    expect(state.draft.articulation).toBeNull()
  })

  it('degrades to empty referenceQa if the Q&A read fails', async () => {
    const { service, prisma, sourceQa } = makePromotionService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_CONCEPT)
    prisma.promotionDraft.findUnique.mockResolvedValue(PASSING_DRAFT)
    sourceQa.recentForContext.mockRejectedValue(new Error('down'))

    const state = await service.getState('u1', 'c1')
    expect(state.referenceQa).toEqual([])
    // Status guard untouched — getState still returns a valid state.
    expect(state.conceptId).toBe('c1')
    expect(ConceptStatus.INBOX).toBe('INBOX')
  })
})
