import type { AiService } from '../ai/ai.service'
import type { ClassifiedBlockInput } from './structure-model.service'
import { TableGeneratorService } from './table-generator.service'
import type { ArticleJsonV2 } from './transformer.types'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new TableGeneratorService(ai)
}

/**
 * The systems article: the source contrasts open / closed / isolated systems by
 * what they exchange, and natural vs human-made systems. Those contrasts SHOULD
 * become comparison tables — but only grounded in the blocks that draw them.
 */
const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'DEFINITION',
    text: 'A system is a set of interacting parts forming a whole.',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'An open system exchanges both matter and energy with its surroundings; a closed system exchanges only energy; an isolated system exchanges neither.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'Natural systems arise without human intervention, such as a forest; human-made systems are engineered, such as a power grid.',
    removable: false,
  },
]

const article: ArticleJsonV2 = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Systems', source: 'original' },
  abstract: [],
  sections: [
    {
      id: 's1',
      heading: 'Kinds of systems',
      headingSource: 'inferred',
      sourceBlockIds: ['b1', 'b2', 'b3'],
      blocks: [
        {
          id: 'p1',
          type: 'paragraph',
          text: 'A system is a set of interacting parts forming a whole.',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
}

describe('TableGeneratorService', () => {
  it('builds source-grounded open/closed/isolated and natural/human-made tables', async () => {
    const service = makeService({
      tables: [
        {
          title: 'Open vs closed vs isolated systems',
          columns: ['System', 'Matter', 'Energy'],
          rows: [
            {
              cells: [
                { text: 'Open', sourceBlockIds: ['b2'] },
                { text: 'Exchanged', sourceBlockIds: ['b2'] },
                { text: 'Exchanged', sourceBlockIds: ['b2'] },
              ],
              sourceBlockIds: ['b2'],
            },
            {
              cells: [
                { text: 'Closed' },
                { text: 'Not exchanged' },
                { text: 'Exchanged' },
              ],
              sourceBlockIds: ['b2'],
            },
            {
              cells: [
                { text: 'Isolated' },
                { text: 'Not exchanged' },
                { text: 'Not exchanged' },
              ],
              sourceBlockIds: ['b2'],
            },
          ],
          relatedSectionIds: ['s1'],
          fidelityRisk: 'low',
        },
        {
          title: 'Natural vs human-made systems',
          columns: ['System', 'Origin', 'Example'],
          rows: [
            {
              cells: [
                { text: 'Natural' },
                { text: 'No human intervention' },
                { text: 'Forest' },
              ],
              sourceBlockIds: ['b3'],
            },
            {
              cells: [
                { text: 'Human-made' },
                { text: 'Engineered' },
                { text: 'Power grid' },
              ],
              sourceBlockIds: ['b3'],
            },
          ],
          relatedSectionIds: ['s1'],
          fidelityRisk: 'low',
        },
      ],
    })

    const tables = await service.generate(article, blocks)
    expect(tables).toHaveLength(2)

    const [systems, origins] = tables
    expect(systems.id).toBe('gtbl-0')
    expect(systems.columns).toEqual(['System', 'Matter', 'Energy'])
    expect(systems.rows).toHaveLength(3)
    expect(systems.sourceBlockIds).toEqual(['b2'])
    expect(systems.relatedSectionIds).toEqual(['s1'])
    // Per-cell grounding is kept where the model supplied it.
    expect(systems.rows[0].cells[0]).toEqual({
      text: 'Open',
      sourceBlockIds: ['b2'],
    })
    // A cell without grounding leans on the row and carries no ids.
    expect(systems.rows[1].cells[0]).toEqual({ text: 'Closed' })

    expect(origins.id).toBe('gtbl-1')
    expect(origins.rows).toHaveLength(2)
    expect(origins.sourceBlockIds).toEqual(['b3'])
  })

  it('rejects a table that requires external facts (ungrounded rows)', async () => {
    const service = makeService({
      tables: [
        {
          title: 'CPU vs GPU throughput', // nothing in the source supports this
          columns: ['Chip', 'TFLOPs'],
          rows: [
            {
              cells: [{ text: 'CPU' }, { text: '2' }],
              sourceBlockIds: ['ghost'],
            },
            {
              cells: [{ text: 'GPU' }, { text: '40' }],
              sourceBlockIds: [],
            },
          ],
          relatedSectionIds: ['s1'],
          fidelityRisk: 'low',
        },
      ],
    })

    const tables = await service.generate(article, blocks)
    expect(tables).toHaveLength(0)
  })

  it('drops a table with fewer than two grounded rows', async () => {
    const service = makeService({
      tables: [
        {
          title: 'Single row',
          columns: ['System', 'Matter'],
          rows: [
            {
              cells: [{ text: 'Open' }, { text: 'Yes' }],
              sourceBlockIds: ['b2'],
            },
            {
              cells: [{ text: 'Closed' }, { text: 'No' }],
              sourceBlockIds: ['ghost'],
            },
          ],
          relatedSectionIds: [],
          fidelityRisk: 'low',
        },
      ],
    })
    // Only one row survives grounding → not a comparison → dropped.
    const tables = await service.generate(article, blocks)
    expect(tables).toHaveLength(0)
  })
})
