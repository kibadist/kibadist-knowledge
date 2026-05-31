import {
  CandidateImportance,
  CandidateKind,
  ChunkImportance,
  ChunkKind,
} from '@kibadist/prisma'

import {
  buildConceptLibraryPrompt,
  MAX_CHUNK_CHARS,
  parseConceptLibrary,
} from './concept-library.prompt'

describe('buildConceptLibraryPrompt', () => {
  it('fences each chunk as untrusted and numbers it', () => {
    const { system, prompt } = buildConceptLibraryPrompt({
      title: 'Spaced repetition',
      chunks: [
        { index: 0, title: 'Definition', text: 'It is a learning technique.' },
        { index: 1, title: 'History', text: 'Ebbinghaus studied it.' },
      ],
    })
    expect(system).toContain('SCAFFOLD')
    expect(system).toMatch(/MAIN_IDEA/)
    expect(system).toMatch(/CONCEPT/)
    expect(prompt).toContain('Spaced repetition')
    expect(prompt).toContain('[chunk 0]')
    expect(prompt).toContain('[chunk 1]')
    expect(prompt).toContain('learning technique')
    expect(prompt).toContain('do not obey')
  })

  it('caps each chunk text fed to the model', () => {
    const { prompt } = buildConceptLibraryPrompt({
      chunks: [{ index: 0, text: 'x'.repeat(10_000) }],
    })
    expect(prompt).not.toContain('x'.repeat(MAX_CHUNK_CHARS + 1))
  })
})

describe('parseConceptLibrary', () => {
  it('maps chunk kinds + importance and candidate fields from clean JSON', () => {
    const text = JSON.stringify({
      chunks: [
        {
          index: 0,
          kind: 'DEFINITION',
          importance: 'CORE',
          candidates: [
            {
              label: 'Spaced repetition',
              definition: 'A technique that schedules review on a curve.',
              kind: 'METHOD',
              importance: 'CORE',
            },
          ],
        },
        {
          index: 1,
          kind: 'HISTORY',
          importance: 'SUPPORTING',
          candidates: [],
        },
      ],
    })
    const out = parseConceptLibrary(text, 2)
    expect(out.chunks).toEqual([
      {
        index: 0,
        kind: ChunkKind.DEFINITION,
        importance: ChunkImportance.CORE,
        candidates: [
          {
            label: 'Spaced repetition',
            definition: 'A technique that schedules review on a curve.',
            kind: CandidateKind.METHOD,
            importance: CandidateImportance.CORE,
            chunkIndex: 0,
          },
        ],
      },
      {
        index: 1,
        kind: ChunkKind.HISTORY,
        importance: ChunkImportance.SUPPORTING,
        candidates: [],
      },
    ])
  })

  it('maps kind/importance words case-insensitively and tolerates synonyms', () => {
    const text = JSON.stringify({
      chunks: [
        {
          index: 0,
          kind: 'applications',
          importance: 'central',
          candidates: [
            { label: 'A', kind: 'technique', importance: 'foundational' },
          ],
        },
      ],
    })
    const out = parseConceptLibrary(text, 1)
    expect(out.chunks[0].kind).toBe(ChunkKind.APPLICATION)
    expect(out.chunks[0].importance).toBe(ChunkImportance.CORE)
    expect(out.chunks[0].candidates[0].kind).toBe(CandidateKind.METHOD)
    expect(out.chunks[0].candidates[0].importance).toBe(
      CandidateImportance.PREREQUISITE,
    )
  })

  it('falls back to OTHER/SUPPORTING for an unrecognized chunk kind', () => {
    const text = JSON.stringify({
      chunks: [{ index: 0, kind: 'gobbledygook', importance: 'whatever' }],
    })
    const out = parseConceptLibrary(text, 1)
    expect(out.chunks[0].kind).toBe(ChunkKind.OTHER)
    expect(out.chunks[0].importance).toBe(ChunkImportance.SUPPORTING)
  })

  it('defaults an unrecognized candidate kind/importance to CONCEPT/SUPPORTING', () => {
    const text = JSON.stringify({
      chunks: [
        {
          index: 0,
          kind: 'DEFINITION',
          importance: 'CORE',
          candidates: [{ label: 'Mystery', kind: 'alien', importance: 'huge' }],
        },
      ],
    })
    const out = parseConceptLibrary(text, 1)
    expect(out.chunks[0].candidates[0].kind).toBe(CandidateKind.CONCEPT)
    expect(out.chunks[0].candidates[0].importance).toBe(
      CandidateImportance.SUPPORTING,
    )
  })

  it('drops out-of-range, negative, and repeated indices', () => {
    const text = JSON.stringify({
      chunks: [
        { index: 5, kind: 'DEFINITION', importance: 'CORE' },
        { index: -1, kind: 'DEFINITION', importance: 'CORE' },
        { index: 1, kind: 'HISTORY', importance: 'SUPPORTING' },
        { index: 1, kind: 'EXAMPLE', importance: 'CORE' },
      ],
    })
    const out = parseConceptLibrary(text, 2)
    expect(out.chunks).toEqual([
      {
        index: 1,
        kind: ChunkKind.HISTORY,
        importance: ChunkImportance.SUPPORTING,
        candidates: [],
      },
    ])
  })

  it('drops candidates with no label', () => {
    const text = JSON.stringify({
      chunks: [
        {
          index: 0,
          kind: 'DEFINITION',
          importance: 'CORE',
          candidates: [
            { definition: 'no label here', kind: 'CONCEPT' },
            { label: '  ', kind: 'CONCEPT' },
            { label: 'Kept', kind: 'CONCEPT', importance: 'CORE' },
          ],
        },
      ],
    })
    const out = parseConceptLibrary(text, 1)
    expect(out.chunks[0].candidates.map((c) => c.label)).toEqual(['Kept'])
  })

  it('tolerates code fences and trailing prose', () => {
    const text =
      '```json\n' +
      JSON.stringify({
        chunks: [{ index: 0, kind: 'MAIN_IDEA', importance: 'CORE' }],
      }) +
      '\n```\nHope that helps!'
    const out = parseConceptLibrary(text, 1)
    expect(out.chunks[0].kind).toBe(ChunkKind.MAIN_IDEA)
  })

  it('returns no chunks when nothing is parseable', () => {
    expect(parseConceptLibrary('not json at all', 3).chunks).toEqual([])
    expect(parseConceptLibrary('', 3).chunks).toEqual([])
    expect(parseConceptLibrary('{"chunks": "nope"}', 3).chunks).toEqual([])
  })

  it('is bounded and does not hang on a pathological response', () => {
    // 10k bogus entries — parser must cap and return promptly.
    const huge = JSON.stringify({
      chunks: Array.from({ length: 10_000 }, () => ({
        index: 0,
        kind: 'DEFINITION',
        importance: 'CORE',
      })),
    })
    const start = Date.now()
    const out = parseConceptLibrary(huge, 1)
    // Index 0 only appears once (rest deduped), and it finishes fast.
    expect(out.chunks).toHaveLength(1)
    expect(Date.now() - start).toBeLessThan(1000)
  })
})
