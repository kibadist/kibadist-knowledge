import { NotFoundException } from '@nestjs/common'
import type { AiService } from '../ai/ai.service'
import { LearningLayerService } from './learning-layer.service'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleJsonV2 } from './transformer.types'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new LearningLayerService(ai)
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'x',
    removable: false,
  },
]

describe('LearningLayerService', () => {
  it('starts every concept validationStatus at pending and mints ids', async () => {
    const service = makeService({
      concepts: [{ label: 'L', definition: 'D', sourceBlockIds: ['b1'] }],
      retrievalPrompts: [{ prompt: 'Q?', sourceBlockIds: ['b1'] }],
    })
    const layer = await service.build(blocks)
    expect(layer.concepts).toHaveLength(1)
    expect(layer.concepts[0].validationStatus).toBe('pending')
    expect(layer.concepts[0].id).toBeTruthy()
    expect(layer.retrievalPrompts[0].id).toBeTruthy()
  })

  it('drops concepts and prompts without valid sourceBlockIds', async () => {
    const service = makeService({
      concepts: [
        { label: 'L', definition: 'D', sourceBlockIds: [] },
        { label: 'L2', definition: 'D2', sourceBlockIds: ['ghost'] },
        { label: 'L3', definition: 'D3', sourceBlockIds: ['b1'] },
      ],
      retrievalPrompts: [{ prompt: 'Q?', sourceBlockIds: ['ghost'] }],
    })
    const layer = await service.build(blocks)
    expect(layer.concepts).toHaveLength(1)
    expect(layer.concepts[0].label).toBe('L3')
    expect(layer.retrievalPrompts).toHaveLength(0)
  })
})

// --- DET-283: per-section concept candidates --------------------------------

const candidateBlocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'heading source',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'body of the section',
    removable: false,
  },
  {
    id: 'b9',
    type: 'PARAGRAPH',
    classification: 'EXAMPLE',
    text: 'subsection body',
    removable: false,
  },
  // A block that exists but is NOT cited by the target section — candidates must
  // never ground in it (out of section scope).
  {
    id: 'bOther',
    type: 'PARAGRAPH',
    classification: 'BACKGROUND',
    text: 'a block from another section',
    removable: false,
  },
]

function candidateArticle(): ArticleJsonV2 {
  return {
    schemaVersion: 'v2',
    mode: 'source_preserving_article',
    title: { text: 'T', source: 'original' },
    abstract: [],
    sections: [
      {
        id: 's1',
        heading: 'Concepts section',
        headingSource: 'original',
        headingSourceBlockIds: ['b1'],
        sectionRole: 'definition',
        sourceBlockIds: ['b2'],
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            text: 'body of the section',
            sourceBlockIds: ['b2'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
        subsections: [
          {
            id: 's1a',
            heading: 'Nested',
            headingSource: 'inferred',
            sourceBlockIds: ['b9'],
            blocks: [
              {
                id: 'p2',
                type: 'paragraph',
                text: 'subsection body',
                sourceBlockIds: ['b9'],
                transformationType: 'verbatim',
                fidelityRisk: 'low',
              },
            ],
          },
        ],
      },
    ],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    originalStructure: [],
  }
}

describe('LearningLayerService.extractCandidatesForSection (DET-283)', () => {
  it('throws NotFound for an unknown sectionId', async () => {
    const service = makeService({ candidates: [] })
    await expect(
      service.extractCandidatesForSection(
        candidateArticle(),
        'ghost',
        candidateBlocks,
      ),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('finds a subsection by id and scopes candidates to that subsection', async () => {
    // The subsection cites only b9; candidates can only ground in b9.
    const service = makeService({
      candidates: [{ label: 'Sub', definition: 'D', sourceBlockIds: ['b9'] }],
    })
    const out = await service.extractCandidatesForSection(
      candidateArticle(),
      's1a',
      candidateBlocks,
    )
    expect(out).toHaveLength(1)
    expect(out[0].sectionId).toBe('s1a')
    expect(out[0].sourceBlockIds).toEqual(['b9'])
  })

  it('forces aiAssisted + pending, mints ids, and stamps sectionId/sectionRole in code', async () => {
    // The LLM does NOT return id/sectionId/aiAssisted/status — only label,
    // definition, sourceBlockIds — and even if it tried, code wins.
    const service = makeService({
      candidates: [{ label: 'C', definition: 'D', sourceBlockIds: ['b2'] }],
    })
    const out = await service.extractCandidatesForSection(
      candidateArticle(),
      's1',
      candidateBlocks,
    )
    expect(out).toHaveLength(1)
    expect(out[0].id).toBeTruthy()
    expect(out[0].aiAssisted).toBe(true)
    expect(out[0].validationStatus).toBe('pending')
    expect(out[0].sectionId).toBe('s1')
    // Stamped from the actual section, not the prompt.
    expect(out[0].sectionRole).toBe('definition')
    expect(out[0].blockType).toBe('paragraph')
  })

  it('drops ungrounded candidates and ones citing out-of-section blocks', async () => {
    const service = makeService({
      candidates: [
        { label: 'Empty', definition: 'D', sourceBlockIds: [] },
        { label: 'Ghost', definition: 'D', sourceBlockIds: ['nope'] },
        // bOther is a real block but NOT in section s1's scope → dropped.
        { label: 'OutOfScope', definition: 'D', sourceBlockIds: ['bOther'] },
        { label: 'Good', definition: 'D', sourceBlockIds: ['b1', 'b2'] },
      ],
    })
    const out = await service.extractCandidatesForSection(
      candidateArticle(),
      's1',
      candidateBlocks,
    )
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('Good')
    // Heading-source id (b1) + body id (b2) are both in scope.
    expect(out[0].sourceBlockIds).toEqual(['b1', 'b2'])
  })
})
