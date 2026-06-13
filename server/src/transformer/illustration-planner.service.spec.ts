import type { AiService } from '../ai/ai.service'
import { ILLUSTRATION_QUALITY_WARNING } from './illustration-gate.util'
import { IllustrationPlannerService } from './illustration-planner.service'
import type { ClassifiedBlockInput } from './structure-model.service'
import type { ArticleJsonV2 } from './transformer.types'

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new IllustrationPlannerService(ai)
}

// A v2 article whose two sections ground b1 (MAIN_ARGUMENT) and b2 (METHOD) —
// the planner derives each suggestion's `sectionIds` from these.
const article = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'T', source: 'original' },
  abstract: [],
  sections: [
    {
      id: 's1',
      heading: 'Argument',
      headingSource: 'original',
      sourceBlockIds: ['b1'],
      blocks: [
        {
          id: 'sp1',
          type: 'paragraph',
          text: 'x',
          sourceBlockIds: ['b1'],
          transformationType: 'verbatim',
          fidelityRisk: 'low',
        },
      ],
    },
    {
      id: 's2',
      heading: 'Method',
      headingSource: 'original',
      sourceBlockIds: ['b2'],
      blocks: [
        {
          id: 'sp2',
          type: 'paragraph',
          text: 'step 1; step 2',
          sourceBlockIds: ['b2'],
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
} as unknown as ArticleJsonV2

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'MAIN_ARGUMENT',
    text: 'x',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'METHOD',
    text: 'step 1; step 2',
    removable: false,
  },
]

describe('IllustrationPlannerService', () => {
  it('drops suggestions without valid sourceBlockIds and starts approval pending', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'editorial_cover',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: [], // dropped
        },
        {
          illustrationType: 'decorative_section',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: ['ghost'], // unknown → dropped
        },
        {
          illustrationType: 'editorial_cover',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: ['b1'], // kept
        },
      ],
    })

    const plan = await service.plan(article, blocks)
    expect(plan.suggestions).toHaveLength(1)
    expect(plan.suggestions[0].sourceBlockIds).toEqual(['b1'])
    expect(plan.suggestions[0].approval).toBe('pending')
    expect(plan.suggestions[0].id).toBeTruthy()
  })

  it('forces high fidelityRisk on a source_based_diagram not backed by a METHOD block', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low', // model says low; code forces high
          reason: 'r',
          sourceBlockIds: ['b1'], // MAIN_ARGUMENT, not METHOD
        },
      ],
    })
    const plan = await service.plan(article, blocks)
    expect(plan.suggestions[0].fidelityRisk).toBe('high')
  })

  it('allows a source_based_diagram backed solely by METHOD blocks to keep its risk', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'medium',
          reason: 'r',
          sourceBlockIds: ['b2'], // METHOD
        },
      ],
    })
    const plan = await service.plan(article, blocks)
    expect(plan.suggestions[0].fidelityRisk).toBe('medium')
  })

  // DET-360: a diagram spec must reference source blocks AND article sections.
  it('resolves sectionIds for a diagram and drops one that grounds in no section', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'medium',
          reason: 'r',
          sourceBlockIds: ['b2'], // grounded in s2
        },
      ],
    })
    const plan = await service.plan(article, blocks)
    expect(plan.suggestions[0].sectionIds).toEqual(['s2'])
    expect(plan.suggestions[0].sourceBlockIds).toEqual(['b2'])
  })

  it('drops a source_based_diagram whose cited blocks appear in no article section', async () => {
    // b3 is a real classified block but no section cites it → no section anchor.
    const orphanBlocks: ClassifiedBlockInput[] = [
      ...blocks,
      {
        id: 'b3',
        type: 'PARAGRAPH',
        classification: 'METHOD',
        text: 'orphan steps',
        removable: false,
      },
    ]
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'medium',
          reason: 'r',
          sourceBlockIds: ['b3'],
        },
      ],
    })
    const plan = await service.plan(article, orphanBlocks)
    expect(plan.suggestions).toHaveLength(0)
  })

  // DET-360: quality gate. A not-ready article still gets DRAFT suggestions, but
  // each is marked ineligible with a quality warning.
  it('marks every suggestion ineligible with a warning when quality is not ready', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'editorial_cover',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: ['b1'],
        },
      ],
    })
    const plan = await service.plan(article, blocks, { qualityReady: false })
    expect(plan.suggestions[0].eligible).toBe(false)
    expect(plan.suggestions[0].qualityWarning).toBe(
      ILLUSTRATION_QUALITY_WARNING,
    )
  })

  it('marks suggestions eligible and warning-free when quality passes', async () => {
    const service = makeService({
      suggestions: [
        {
          illustrationType: 'editorial_cover',
          purpose: 'p',
          visualDescription: 'v',
          caption: 'c',
          fidelityRisk: 'low',
          reason: 'r',
          sourceBlockIds: ['b1'],
        },
      ],
    })
    const plan = await service.plan(article, blocks, { qualityReady: true })
    expect(plan.suggestions[0].eligible).toBe(true)
    expect(plan.suggestions[0].qualityWarning).toBeUndefined()
  })

  // --- Acceptance fixtures (DET-360) ---------------------------------------
  // A renderable diagram is suggested ONLY after quality passes; while the
  // article is not ready the same diagram is a draft (ineligible + warned).

  it('transformer fixture: suggests a decoder/attention flow diagram only after quality passes', async () => {
    const transformerArticle = {
      schemaVersion: 'v2',
      mode: 'source_preserving_article',
      title: { text: 'The Transformer', source: 'original' },
      abstract: [],
      sections: [
        {
          id: 'sec-decoder',
          heading: 'Decoder attention flow',
          headingSource: 'original',
          sourceBlockIds: ['tb1'],
          blocks: [
            {
              id: 'tp1',
              type: 'paragraph',
              text: 'masked self-attention → encoder-decoder attention → FFN',
              sourceBlockIds: ['tb1'],
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
    } as unknown as ArticleJsonV2
    const transformerBlocks: ClassifiedBlockInput[] = [
      {
        id: 'tb1',
        type: 'PARAGRAPH',
        classification: 'METHOD',
        text: 'The decoder runs masked self-attention, then encoder-decoder attention, then a feed-forward network.',
        removable: false,
      },
    ]
    const llm = {
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'Show the decoder attention flow',
          visualDescription:
            'A flow: masked self-attention → encoder-decoder attention → feed-forward network',
          caption: 'Decoder attention flow',
          fidelityRisk: 'medium',
          reason: 'The source METHOD block enumerates the decoder steps',
          sourceBlockIds: ['tb1'],
        },
      ],
    }

    // Quality NOT ready → draft only (ineligible, warned), never renderable.
    const draftPlan = await makeService(llm).plan(
      transformerArticle,
      transformerBlocks,
      { qualityReady: false },
    )
    expect(draftPlan.suggestions[0].eligible).toBe(false)
    expect(draftPlan.suggestions[0].qualityWarning).toBeTruthy()

    // Quality passes → an eligible diagram referencing source blocks + sections.
    const readyPlan = await makeService(llm).plan(
      transformerArticle,
      transformerBlocks,
      { qualityReady: true },
    )
    const diagram = readyPlan.suggestions[0]
    expect(diagram.illustrationType).toBe('source_based_diagram')
    expect(diagram.eligible).toBe(true)
    expect(diagram.fidelityRisk).toBe('medium') // METHOD-backed, risk preserved
    expect(diagram.sourceBlockIds).toEqual(['tb1'])
    expect(diagram.sectionIds).toEqual(['sec-decoder'])
  })

  it('systems fixture: suggests an open/closed/isolated system diagram only after quality passes', async () => {
    const systemsArticle = {
      schemaVersion: 'v2',
      mode: 'source_preserving_article',
      title: { text: 'Thermodynamic systems', source: 'original' },
      abstract: [],
      sections: [
        {
          id: 'sec-systems',
          heading: 'Kinds of system',
          headingSource: 'original',
          sourceBlockIds: ['sb1'],
          blocks: [
            {
              id: 'ssp1',
              type: 'paragraph',
              text: 'open, closed, and isolated systems',
              sourceBlockIds: ['sb1'],
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
    } as unknown as ArticleJsonV2
    const systemsBlocks: ClassifiedBlockInput[] = [
      {
        id: 'sb1',
        type: 'PARAGRAPH',
        classification: 'METHOD',
        text: 'An open system exchanges matter and energy; a closed system exchanges only energy; an isolated system exchanges neither.',
        removable: false,
      },
    ]
    const llm = {
      suggestions: [
        {
          illustrationType: 'source_based_diagram',
          purpose: 'Contrast open, closed, and isolated systems',
          visualDescription:
            'Three boxes: open (matter+energy), closed (energy), isolated (neither)',
          caption: 'Open, closed, and isolated systems',
          fidelityRisk: 'medium',
          reason: 'The source defines all three system boundaries',
          sourceBlockIds: ['sb1'],
        },
      ],
    }

    const draftPlan = await makeService(llm).plan(
      systemsArticle,
      systemsBlocks,
      { qualityReady: false },
    )
    expect(draftPlan.suggestions[0].eligible).toBe(false)

    const readyPlan = await makeService(llm).plan(
      systemsArticle,
      systemsBlocks,
      {
        qualityReady: true,
      },
    )
    const diagram = readyPlan.suggestions[0]
    expect(diagram.illustrationType).toBe('source_based_diagram')
    expect(diagram.eligible).toBe(true)
    expect(diagram.sourceBlockIds).toEqual(['sb1'])
    expect(diagram.sectionIds).toEqual(['sec-systems'])
  })
})
