import type { AiService } from '../ai/ai.service'
import {
  EditorialLayoutService,
  sanitizeEditorialLayout,
} from './editorial-layout.service'
import type { EditorialLayoutLlm } from './schemas'
import type { ArticleJsonV2 } from './transformer.types'

/**
 * Editorial-layout spec (editorial layout lane). The strict work lives in the
 * pure `sanitizeEditorialLayout` helper, so we test it directly without the
 * network: it drops furniture citing unknown section/block ids, clamps every
 * afterParagraphIndex, omits a sub-3 stat band and empty fields, and never emits
 * figurePlacements. `build` gets one mocked-AI smoke test.
 */

const article = {
  schemaVersion: 'v2',
  mode: 'source_preserving_article',
  title: { text: 'Honeybees', source: 'original' },
  abstract: [
    {
      id: 'p-abs',
      text: 'An overview.',
      sourceBlockIds: ['b1'],
      transformationType: 'verbatim',
      fidelityRisk: 'low',
    },
  ],
  sections: [
    {
      id: 's1',
      heading: 'Anatomy',
      headingSource: 'original',
      sourceBlockIds: ['b1'],
      blocks: [
        { id: 'sp1', type: 'paragraph', text: 'First.' },
        { id: 'sp2', type: 'paragraph', text: 'Second.' },
      ],
    },
    {
      id: 's2',
      heading: 'Behavior',
      headingSource: 'original',
      sourceBlockIds: ['b2'],
      blocks: [{ id: 'sp3', type: 'paragraph', text: 'Only.' }],
    },
  ],
  keyTerms: [],
  sourceExamples: [],
  caveats: [],
  originalStructure: [],
} as unknown as ArticleJsonV2

/** A fully-permissive LLM reply; each test overrides the slice it cares about. */
function llm(overrides: Partial<EditorialLayoutLlm>): EditorialLayoutLlm {
  return {
    subheads: [],
    marginalNotes: [],
    ...overrides,
  } as EditorialLayoutLlm
}

describe('sanitizeEditorialLayout', () => {
  it('keeps kicker/standfirst and a valid pull-quote with its blockId', () => {
    const out = sanitizeEditorialLayout(
      llm({
        kicker: { text: 'Field guide · Insect', grounded: false },
        standfirst: { text: 'A one-line lede.', grounded: false },
        pullQuote: {
          sectionId: 's1',
          blockId: 'sp2',
          text: 'The sharpest line.',
          grounded: true,
        },
      }),
      article,
    )
    expect(out.kicker).toEqual({
      text: 'Field guide · Insect',
      grounded: false,
    })
    expect(out.standfirst?.text).toBe('A one-line lede.')
    expect(out.pullQuote).toEqual({
      sectionId: 's1',
      blockId: 'sp2',
      text: 'The sharpest line.',
      grounded: true,
    })
  })

  it('drops subheads / marginal notes / pull-quote with an unknown section id', () => {
    const out = sanitizeEditorialLayout(
      llm({
        subheads: [{ sectionId: 'ghost', afterParagraphIndex: 0, text: 'x' }],
        marginalNotes: [
          {
            sectionId: 'ghost',
            afterParagraphIndex: 0,
            title: 't',
            text: 'x',
            grounded: false,
          },
        ],
        pullQuote: {
          sectionId: 'ghost',
          text: 'orphan',
          grounded: false,
        },
      }),
      article,
    )
    expect(out.subheads).toBeUndefined()
    expect(out.marginalNotes).toBeUndefined()
    expect(out.pullQuote).toBeUndefined()
  })

  it('drops a pull-quote blockId that does not exist but keeps the quote', () => {
    const out = sanitizeEditorialLayout(
      llm({
        pullQuote: {
          sectionId: 's1',
          blockId: 'nope',
          text: 'paraphrased',
          grounded: false,
        },
      }),
      article,
    )
    expect(out.pullQuote).toEqual({
      sectionId: 's1',
      text: 'paraphrased',
      grounded: false,
    })
    expect(out.pullQuote?.blockId).toBeUndefined()
  })

  it('clamps afterParagraphIndex to [0, paragraphCount] of the section', () => {
    const out = sanitizeEditorialLayout(
      llm({
        subheads: [
          { sectionId: 's1', afterParagraphIndex: 99, text: 'over' },
          { sectionId: 's2', afterParagraphIndex: -5, text: 'under' },
        ],
      }),
      article,
    )
    // s1 has 2 paragraphs → clamp to 2; s2 has 1 → negative clamps to 0.
    expect(out.subheads).toEqual([
      { sectionId: 's1', afterParagraphIndex: 2, text: 'over' },
      { sectionId: 's2', afterParagraphIndex: 0, text: 'under' },
    ])
  })

  it('omits a stat band with fewer than three stats', () => {
    const out = sanitizeEditorialLayout(
      llm({
        statBand: {
          grounded: true,
          stats: [
            { figure: '1', label: 'a' },
            { figure: '2', label: 'b' },
          ],
        },
      }),
      article,
    )
    expect(out.statBand).toBeUndefined()
  })

  it('keeps a stat band of three or more (clamped to four)', () => {
    const out = sanitizeEditorialLayout(
      llm({
        statBand: {
          grounded: true,
          stats: [
            { figure: '1', label: 'a' },
            { figure: '2', label: 'b' },
            { figure: '3', label: 'c' },
            { figure: '4', label: 'd' },
            { figure: '5', label: 'e' },
          ],
        },
      }),
      article,
    )
    expect(out.statBand?.grounded).toBe(true)
    expect(out.statBand?.stats).toHaveLength(4)
  })

  it('returns an empty object and never emits figurePlacements for an empty reply', () => {
    const out = sanitizeEditorialLayout(llm({}), article)
    expect(out).toEqual({})
    expect(
      (out as { figurePlacements?: unknown }).figurePlacements,
    ).toBeUndefined()
  })
})

describe('EditorialLayoutService.build', () => {
  it('parses the LLM reply through the schema and sanitizes it', async () => {
    const complete = jest.fn().mockResolvedValue({
      text: JSON.stringify({
        kicker: { text: 'Field guide · Insect', grounded: false },
        pullQuote: { sectionId: 's1', text: 'A line.', grounded: false },
        // An invalid anchor + unknown section are scrubbed by the sanitizer.
        subheads: [{ sectionId: 'ghost', afterParagraphIndex: 9, text: 'x' }],
      }),
      model: 'stub',
    })
    const ai = { complete } as unknown as AiService
    const service = new EditorialLayoutService(ai)

    const out = await service.build(article)

    expect(out.kicker?.text).toBe('Field guide · Insect')
    expect(out.pullQuote?.sectionId).toBe('s1')
    expect(out.subheads).toBeUndefined()
    // The model is prompted with the article's real section ids to anchor against.
    const userPrompt = complete.mock.calls[0][0].prompt as string
    expect(userPrompt).toContain('[s1] Anatomy')
    expect(userPrompt).toContain('[s2] Behavior')
  })
})
