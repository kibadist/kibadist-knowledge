import type { AiService } from '../ai/ai.service'
import {
  segmentationFixtures,
  systemsArticle,
  transformerTranscript,
} from './__fixtures__/segmentation-fixtures'
import { ConceptualSegmentationService } from './conceptual-segmentation.service'
import { findUnreasonedHighImportanceBlocks } from './conceptual-segmentation.util'
import type { SourceStructureModel } from './schemas'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return { service: new ConceptualSegmentationService(ai), complete }
}

const trivialModel: SourceStructureModel = {
  title: null,
  subtitle: null,
  claims: [],
  definitions: [],
  examples: [],
  caveats: [],
  terminology: [],
  originalOutline: [],
  noiseDecisions: [],
  uncertainBlockIds: [],
}

describe.each(
  segmentationFixtures.map((f) => [f.name, f] as const),
)('ConceptualSegmentationService — %s fixture (DET-347)', (_name, fixture) => {
  it('produces segments covering every required learning topic', async () => {
    const { service } = makeService(fixture.llmResponse)
    const result = await service.segment(fixture.structureModel, fixture.blocks)

    const titles = result.segments.map((s) => s.title.toLowerCase())
    const missing = fixture.requiredTopics.filter(
      (topic) => !titles.some((t) => t.includes(topic)),
    )
    // An empty `missing` proves every required learning topic is covered; the
    // array surfaces exactly which topic is absent if the assertion fails.
    expect(missing).toEqual([])
  })

  it('mints stable seg-N ids in source-reading order', async () => {
    const { service } = makeService(fixture.llmResponse)
    const result = await service.segment(fixture.structureModel, fixture.blocks)

    // Ids are sequential and code-minted (never trusted from the model).
    expect(result.segments.map((s) => s.id)).toEqual(
      result.segments.map((_s, i) => `seg-${i}`),
    )

    // Segments are ordered by their earliest cited block — the source arc.
    const orderOf = new Map(fixture.blocks.map((b, i) => [b.id, i]))
    const earliest = (ids: string[]) =>
      Math.min(...ids.map((id) => orderOf.get(id) ?? Number.POSITIVE_INFINITY))
    const keys = result.segments.map((s) => earliest(s.sourceBlockIds))
    expect(keys).toEqual([...keys].sort((a, b) => a - b))
  })

  it('leaves no high-importance block unsegmented without a reason', async () => {
    const { service } = makeService(fixture.llmResponse)
    const result = await service.segment(fixture.structureModel, fixture.blocks)
    expect(findUnreasonedHighImportanceBlocks(fixture.blocks, result)).toEqual(
      [],
    )
  })

  it('keeps every segment fully traceable to real source blocks', async () => {
    const { service } = makeService(fixture.llmResponse)
    const result = await service.segment(fixture.structureModel, fixture.blocks)
    const known = new Set(fixture.blocks.map((b) => b.id))
    for (const seg of result.segments) {
      expect(seg.sourceBlockIds.length).toBeGreaterThan(0)
      for (const id of seg.sourceBlockIds) expect(known.has(id)).toBe(true)
    }
  })
})

describe('ConceptualSegmentationService — transformer transcript specifics', () => {
  it('re-sorts the out-of-order model response so layer norm precedes the non-linearity', async () => {
    const { service } = makeService(transformerTranscript.llmResponse)
    const result = await service.segment(
      transformerTranscript.structureModel,
      transformerTranscript.blocks,
    )
    const titles = result.segments.map((s) => s.title)
    // Source order is t5 (layer norm) before t6 (non-linearity); the model listed
    // them reversed, so the service must put them back into source order.
    expect(titles.indexOf('Layer norm')).toBeLessThan(
      titles.indexOf('Why we need a non-linearity'),
    )
  })

  it('records the spoken-filler block under unsegmentedBlocks (not silently dropped)', async () => {
    const { service } = makeService(transformerTranscript.llmResponse)
    const result = await service.segment(
      transformerTranscript.structureModel,
      transformerTranscript.blocks,
    )
    expect(result.unsegmentedBlocks.map((u) => u.blockId)).toContain('t0')
  })
})

describe('ConceptualSegmentationService — coverage guard', () => {
  it('synthesizes a reason + warning for a high-importance block the model dropped', async () => {
    // A response that segments only s0/s1 and forgets the rest of the systems
    // article's high-importance blocks (s3, s5 is EXAMPLE→high, s7, s9, s11).
    const { service } = makeService({
      segments: [
        {
          title: 'Definition of a system',
          role: 'definition',
          sourceBlockIds: ['s0', 's1'],
          importance: 'high',
          summary: 'A system is an integrated whole.',
          mustPreserveClaims: [],
          suggestedArticlePlacement: 'main_body',
        },
      ],
      unsegmentedBlocks: [],
    })

    const result = await service.segment(
      systemsArticle.structureModel,
      systemsArticle.blocks,
    )

    // Every orphaned high-importance block now carries a recorded reason…
    expect(
      findUnreasonedHighImportanceBlocks(systemsArticle.blocks, result),
    ).toEqual([])
    // …with a matching audit warning, and the dropped DEFINITION s3 is recorded.
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.unsegmentedBlocks.map((u) => u.blockId)).toContain('s3')
    const s3 = result.unsegmentedBlocks.find((u) => u.blockId === 's3')
    expect(s3?.reason).toMatch(/high-importance/i)
  })

  it('fails loudly when the model grounds nothing real (all ids invented)', async () => {
    const { service } = makeService({
      segments: [
        {
          title: 'ghost',
          role: 'definition',
          sourceBlockIds: ['nope'],
          importance: 'high',
          summary: 'x',
          mustPreserveClaims: [],
          suggestedArticlePlacement: 'main_body',
        },
      ],
      unsegmentedBlocks: [],
    })
    // repair drops the only segment → schema's segments.min(1) rejects → throws.
    await expect(
      service.segment(trivialModel, [
        {
          id: 'b1',
          type: 'PARAGRAPH',
          classification: 'DEFINITION',
          text: 'real',
          removable: false,
        },
      ]),
    ).rejects.toThrow()
  })
})
