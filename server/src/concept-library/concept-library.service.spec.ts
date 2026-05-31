import {
  CandidateImportance,
  CandidateKind,
  ChunkImportance,
  ChunkKind,
  Generator,
} from '@kibadist/prisma'
import { NotFoundException } from '@nestjs/common'

import { ConceptLibraryService } from './concept-library.service'

/**
 * A SourceDocument shaped like a typical encyclopedia article: a definition
 * section, a History section, an Applications section, and a References section.
 * Each section is a major (level-2) heading so chunkDocument carves one chunk per
 * section (plus the intro if any). Block ids are stable per the DET-210 contract.
 */
const WIKI_DOC = {
  version: 1,
  title: 'Spaced repetition',
  extractor: 'mediawiki@1',
  degraded: false,
  blocks: [
    { id: 'b_def_h', type: 'heading', level: 2, text: 'Definition' },
    {
      id: 'b_def_p',
      type: 'paragraph',
      runs: [{ text: 'Spaced repetition schedules reviews on a curve.' }],
    },
    { id: 'b_hist_h', type: 'heading', level: 2, text: 'History' },
    {
      id: 'b_hist_p',
      type: 'paragraph',
      runs: [{ text: 'Ebbinghaus first studied the forgetting curve.' }],
    },
    { id: 'b_app_h', type: 'heading', level: 2, text: 'Applications' },
    {
      id: 'b_app_p',
      type: 'paragraph',
      runs: [{ text: 'Used in language-learning apps like Anki.' }],
    },
    { id: 'b_ref_h', type: 'heading', level: 2, text: 'References' },
    {
      id: 'b_ref_p',
      type: 'paragraph',
      runs: [{ text: 'Ebbinghaus, H. (1885). Memory.' }],
    },
  ],
}

/** A faithful AI classification for WIKI_DOC's four section chunks (indices 0-3). */
const WIKI_AI_RESPONSE = JSON.stringify({
  chunks: [
    {
      index: 0,
      kind: 'DEFINITION',
      importance: 'CORE',
      candidates: [
        {
          label: 'Spaced repetition',
          definition: 'A technique scheduling reviews on a forgetting curve.',
          kind: 'METHOD',
          importance: 'CORE',
        },
      ],
    },
    { index: 1, kind: 'HISTORY', importance: 'SUPPORTING', candidates: [] },
    {
      index: 2,
      kind: 'APPLICATION',
      importance: 'SUPPORTING',
      candidates: [
        { label: 'Anki', definition: 'A flashcard app.', kind: 'APPLICATION' },
      ],
    },
    { index: 3, kind: 'REFERENCE', importance: 'PERIPHERAL', candidates: [] },
  ],
})

function makeService() {
  // A tx client mirroring the subset the service touches inside $transaction.
  const tx = {
    sourceConceptCandidate: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    sourceChunk: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const prisma = {
    concept: {
      findFirst: jest.fn(),
      // The hard invariant: these must NEVER be called by the library service.
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    sourceChunk: { findMany: jest.fn().mockResolvedValue([]) },
    sourceConceptCandidate: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  }
  const ai = { complete: jest.fn() }
  const service = new ConceptLibraryService(prisma as never, ai as never)
  return { service, prisma, ai, tx }
}

/** Make `library()` read back what `generate()` just persisted (chunks present). */
function seedReadback(prisma: ReturnType<typeof makeService>['prisma']) {
  prisma.sourceChunk.findMany.mockResolvedValue([
    {
      id: 'sc0',
      conceptId: 'c1',
      title: 'Definition',
      summary: null,
      blockIds: ['b_def_h', 'b_def_p'],
      kind: ChunkKind.DEFINITION,
      importance: ChunkImportance.CORE,
      position: 0,
    },
  ])
}

describe('ConceptLibraryService.generate', () => {
  it('THE HARD INVARIANT: never creates or modifies a Concept row', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: WIKI_DOC,
    })
    ai.complete.mockResolvedValue({ text: WIKI_AI_RESPONSE, model: 'test' })
    seedReadback(prisma)

    await service.generate('u1', 'c1')

    expect(prisma.concept.create).not.toHaveBeenCalled()
    expect(prisma.concept.update).not.toHaveBeenCalled()
    expect(prisma.concept.updateMany).not.toHaveBeenCalled()
  })

  it('persists deterministic chunks (SYSTEM) and AI candidates (AI)', async () => {
    const { service, prisma, ai, tx } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: WIKI_DOC,
    })
    ai.complete.mockResolvedValue({ text: WIKI_AI_RESPONSE, model: 'test' })
    // Inside the tx, the chunk read-back maps position → id for candidate wiring.
    tx.sourceChunk.findMany.mockResolvedValue([
      { id: 'sc0', position: 0 },
      { id: 'sc1', position: 1 },
      { id: 'sc2', position: 2 },
      { id: 'sc3', position: 3 },
    ])
    seedReadback(prisma)

    await service.generate('u1', 'c1')

    const chunkRows = tx.sourceChunk.createMany.mock.calls[0][0].data
    expect(chunkRows).toHaveLength(4)
    // Every chunk row is SYSTEM-segmented.
    expect(
      chunkRows.every(
        (r: { generatedBy: Generator }) => r.generatedBy === Generator.SYSTEM,
      ),
    ).toBe(true)
    // Faithful classification mapping per section.
    expect(chunkRows.map((r: { kind: ChunkKind }) => r.kind)).toEqual([
      ChunkKind.DEFINITION,
      ChunkKind.HISTORY,
      ChunkKind.APPLICATION,
      ChunkKind.REFERENCE,
    ])

    const candRows = tx.sourceConceptCandidate.createMany.mock.calls[0][0].data
    // Two candidates extracted (Definition + Applications sections).
    expect(candRows).toHaveLength(2)
    expect(
      candRows.every(
        (r: { generatedBy: Generator }) => r.generatedBy === Generator.AI,
      ),
    ).toBe(true)
    const byLabel = new Map<string, { label: string; chunkId: string }>(
      candRows.map((r: { label: string; chunkId: string }) => [r.label, r]),
    )
    expect(byLabel.get('Spaced repetition')?.chunkId).toBe('sc0')
    expect(byLabel.get('Anki')?.chunkId).toBe('sc2')
  })

  it('WIKIPEDIA CLASSIFICATION: maps section chunks to distinct kinds', async () => {
    const { service, ai, prisma, tx } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: WIKI_DOC,
    })
    ai.complete.mockResolvedValue({ text: WIKI_AI_RESPONSE, model: 'test' })
    tx.sourceChunk.findMany.mockResolvedValue([])
    seedReadback(prisma)

    await service.generate('u1', 'c1')
    const chunkRows = tx.sourceChunk.createMany.mock.calls[0][0].data
    const kinds = chunkRows.map((r: { kind: ChunkKind }) => r.kind)
    // Definition / History / Applications / References map distinctly.
    expect(new Set(kinds).size).toBe(4)
    expect(kinds).toContain(ChunkKind.DEFINITION)
    expect(kinds).toContain(ChunkKind.HISTORY)
    expect(kinds).toContain(ChunkKind.APPLICATION)
    expect(kinds).toContain(ChunkKind.REFERENCE)
  })

  it('is idempotent: deletes prior rows before inserting (regeneration)', async () => {
    const { service, prisma, ai, tx } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: WIKI_DOC,
    })
    ai.complete.mockResolvedValue({ text: WIKI_AI_RESPONSE, model: 'test' })
    seedReadback(prisma)

    await service.generate('u1', 'c1')

    expect(tx.sourceConceptCandidate.deleteMany).toHaveBeenCalledWith({
      where: { conceptId: 'c1', userId: 'u1' },
    })
    expect(tx.sourceChunk.deleteMany).toHaveBeenCalledWith({
      where: { conceptId: 'c1', userId: 'u1' },
    })
  })

  it('degrades gracefully: AI failure still persists deterministic chunks, zero candidates', async () => {
    const { service, prisma, ai, tx } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: WIKI_DOC,
    })
    ai.complete.mockRejectedValue(new Error('provider down'))
    seedReadback(prisma)

    await service.generate('u1', 'c1')

    const chunkRows = tx.sourceChunk.createMany.mock.calls[0][0].data
    expect(chunkRows).toHaveLength(4)
    // Fallback classification: OTHER / SUPPORTING.
    expect(
      chunkRows.every((r: { kind: ChunkKind }) => r.kind === ChunkKind.OTHER),
    ).toBe(true)
    expect(
      chunkRows.every(
        (r: { importance: ChunkImportance }) =>
          r.importance === ChunkImportance.SUPPORTING,
      ),
    ).toBe(true)
    // No candidates persisted (createMany only called for chunks).
    expect(tx.sourceConceptCandidate.createMany).not.toHaveBeenCalled()
    // Still never a Concept write.
    expect(prisma.concept.create).not.toHaveBeenCalled()
    expect(prisma.concept.update).not.toHaveBeenCalled()
  })

  it('returns an empty library when the item has no structured document', async () => {
    const { service, prisma, ai, tx } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: null,
    })

    const out = await service.generate('u1', 'c1')

    expect(out).toEqual({ conceptId: 'c1', chunks: [], candidates: [] })
    expect(ai.complete).not.toHaveBeenCalled()
    // Still clears any stale rows; never creates chunks.
    expect(tx.sourceChunk.createMany).not.toHaveBeenCalled()
  })

  it('404s on a foreign / non-inbox concept', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue(null)
    await expect(service.generate('u1', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})

describe('ConceptLibraryService.library', () => {
  it('returns persisted chunks + non-dismissed candidates when present', async () => {
    const { service, prisma } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: WIKI_DOC,
    })
    prisma.sourceChunk.findMany.mockResolvedValue([
      {
        id: 'sc0',
        conceptId: 'c1',
        title: 'Definition',
        summary: null,
        blockIds: ['b_def_p'],
        kind: ChunkKind.DEFINITION,
        importance: ChunkImportance.CORE,
        position: 0,
      },
    ])
    prisma.sourceConceptCandidate.findMany.mockResolvedValue([
      {
        id: 'cand0',
        conceptId: 'c1',
        chunkId: 'sc0',
        label: 'Spaced repetition',
        definition: 'A scheduling technique.',
        aliases: [],
        sourceBlockIds: ['b_def_p'],
        kind: CandidateKind.METHOD,
        importance: CandidateImportance.CORE,
        generatedBy: Generator.AI,
        promotionStatus: 'CANDIDATE',
      },
    ])

    const out = await service.library('u1', 'c1')

    expect(out.chunks).toHaveLength(1)
    expect(out.candidates).toHaveLength(1)
    // DISMISSED candidates are excluded.
    expect(
      prisma.sourceConceptCandidate.findMany.mock.calls[0][0].where,
    ).toMatchObject({ promotionStatus: { not: 'DISMISSED' } })
    // Did not regenerate (chunks already present → no AI call).
  })

  it('generates on first access when nothing is persisted', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceDocument: WIKI_DOC,
    })
    // First findMany (in library) → empty, triggers generate. generate's
    // requireInboxConcept re-reads, then replaceLibrary, then library() reads
    // back. Keep findMany empty so the final readback also returns [].
    ai.complete.mockResolvedValue({ text: WIKI_AI_RESPONSE, model: 'test' })

    await service.library('u1', 'c1')

    expect(ai.complete).toHaveBeenCalled()
  })
})

describe('ConceptLibraryService.dismiss', () => {
  it('flips a candidate to DISMISSED, scoped to the owner', async () => {
    const { service, prisma } = makeService()
    prisma.sourceConceptCandidate.updateMany.mockResolvedValue({ count: 1 })

    await service.dismiss('u1', 'cand0')

    expect(prisma.sourceConceptCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand0', userId: 'u1' },
      data: { promotionStatus: 'DISMISSED' },
    })
    // Dismissal is scaffold lifecycle only — never a Concept write.
    expect(prisma.concept.update).not.toHaveBeenCalled()
  })

  it('404s when nothing was updated', async () => {
    const { service, prisma } = makeService()
    prisma.sourceConceptCandidate.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.dismiss('u1', 'cand0')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
