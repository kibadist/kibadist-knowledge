import { CaptureSource, ConceptStatus } from '@kibadist/prisma'

import { InboxService } from './inbox.service'

/**
 * Unified capture (DET-300). The inbox is now the single front door: every
 * capture ALSO ingests a companion TransformerSource (the richer artifact) and
 * hard-links its id onto the inbox concept, so one row can route to both the
 * article (read) and the promote gate (process). These tests pin that linkage and
 * the list enrichment without touching the network or a real DB.
 */
function makeService() {
  const tx = {
    concept: {
      create: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  }
  const prisma = {
    concept: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
    },
    transformerSource: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Per-source learning glyph (DET-316): the batched event query, empty by
    // default so most tests see a null glyph.
    articleLearningEvent: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    track: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  }
  const conceptState = { recordCapture: jest.fn().mockResolvedValue(undefined) }
  const transformer = {
    createTextSource: jest.fn().mockResolvedValue({ id: 'src1' }),
    createUrlSourceFromHtml: jest.fn().mockResolvedValue({ id: 'src1' }),
    createPdfSource: jest.fn().mockResolvedValue({ id: 'src1' }),
  }
  const service = new InboxService(
    prisma as never,
    conceptState as never,
    transformer as never,
  )
  return { service, prisma, conceptState, transformer, tx }
}

describe('InboxService unified capture (DET-300)', () => {
  it('captureText ingests a companion source and hard-links its id onto the concept', async () => {
    const { service, transformer, tx } = makeService()
    tx.concept.create.mockResolvedValue({
      id: 'c1',
      title: 'A note',
      sourceText: 'a note body',
      captureSource: CaptureSource.PASTE,
      sourceUrl: null,
      sourceId: 'src1',
      createdAt: new Date('2026-06-06T00:00:00Z'),
    })

    const item = await service.captureText('u1', 'w1', { text: 'a note body' })

    // The companion source was created from the same text...
    expect(transformer.createTextSource).toHaveBeenCalledWith('u1', 'w1', {
      text: 'a note body',
      title: 'a note body',
    })
    // ...and its id was persisted onto the inbox concept.
    expect(tx.concept.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: 'src1',
          status: ConceptStatus.INBOX,
        }),
      }),
    )
    expect(item.sourceId).toBe('src1')
    // The pipeline has only just fired — no article on the fresh row yet.
    expect(item.latestArticleId).toBeNull()
    expect(item.latestArticleStatus).toBeNull()
  })

  it('list() surfaces the companion source latest article so a ready row can Read', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      {
        id: 'c1',
        title: 'A note',
        sourceText: 'body',
        captureSource: CaptureSource.PASTE,
        sourceUrl: null,
        originArticleId: null,
        sourceId: 'src1',
        createdAt: new Date('2026-06-06T00:00:00Z'),
      },
    ])
    prisma.transformerSource.findMany.mockResolvedValue([
      { id: 'src1', articles: [{ id: 'a1', status: 'FINAL' }] },
    ])

    const items = await service.list('u1', 'w1')

    expect(items).toHaveLength(1)
    expect(items[0].sourceId).toBe('src1')
    expect(items[0].latestArticleId).toBe('a1')
    expect(items[0].latestArticleStatus).toBe('FINAL')
    // No events yet → an empty (null) learning glyph.
    expect(items[0].learning).toBeNull()
  })

  it('list() derives the read/recalled/kept glyph from the latest article events (DET-316)', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      {
        id: 'c1',
        title: 'A note',
        sourceText: 'body',
        captureSource: CaptureSource.PASTE,
        sourceUrl: null,
        originArticleId: null,
        sourceId: 'src1',
        createdAt: new Date('2026-06-06T00:00:00Z'),
      },
    ])
    prisma.transformerSource.findMany.mockResolvedValue([
      { id: 'src1', articles: [{ id: 'a1', status: 'FINAL' }] },
    ])
    // Read and recalled (rewrite submitted AND compared), but not yet kept.
    prisma.articleLearningEvent.groupBy.mockResolvedValue([
      { articleId: 'a1', eventType: 'section_revealed' },
      { articleId: 'a1', eventType: 'block_rewrite_submitted' },
      { articleId: 'a1', eventType: 'comparison_generated' },
    ])

    const items = await service.list('u1', 'w1')

    expect(items[0].learning).toEqual({
      read: true,
      recalled: true,
      kept: false,
    })
    // Batched, not per-row: one grouped event query for the whole list.
    expect(prisma.articleLearningEvent.groupBy).toHaveBeenCalledTimes(1)
  })

  it('forge composes existing captures and never ingests a companion source', async () => {
    const { service, prisma, transformer, tx } = makeService()
    prisma.concept.findMany.mockResolvedValue([
      { id: 'a', title: 'One', sourceText: 'first', sourceUrl: null },
      { id: 'b', title: 'Two', sourceText: 'second', sourceUrl: null },
    ])
    tx.concept.create.mockResolvedValue({
      id: 'merged',
      title: 'One + 1 more',
      sourceText: 'first\n\n———\n\nsecond',
      captureSource: CaptureSource.PASTE,
      sourceUrl: null,
      createdAt: new Date('2026-06-06T00:00:00Z'),
    })
    tx.concept.deleteMany.mockResolvedValue({ count: 2 })

    const merged = await service.forge('u1', 'w1', ['a', 'b'])

    expect(transformer.createTextSource).not.toHaveBeenCalled()
    expect(transformer.createUrlSourceFromHtml).not.toHaveBeenCalled()
    expect(transformer.createPdfSource).not.toHaveBeenCalled()
    expect(merged.sourceId).toBeNull()
    expect(merged.latestArticleId).toBeNull()
  })
})
