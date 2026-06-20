import type { AiService } from '../ai/ai.service'
import { ArticleGeneratorService } from './article-generator.service'
import type { ReshapingPlan } from './schemas'
import type { ClassifiedBlockInput } from './structure-model.service'

/**
 * Generator spec (DET-271). The model now returns a NATIVE v2 typed-block article
 * (minus the code-owned fields). We mock the LLM and assert the CODE guarantees:
 *  - `schemaVersion: 'v2'` is stamped in code (the model never sends it).
 *  - `assertKnownIds` walks ALL typed block types + subsections; an unknown id in
 *    a table (or any) block fails loudly.
 *  - later-wave fields are absent (the LLM schema cannot carry them).
 *  - `originalStructure` is re-derived deterministically from the kept blocks.
 */

function makeService(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new ArticleGeneratorService(ai)
}

const plan: ReshapingPlan = {
  titleProposal: { text: 'T', source: 'original' },
  // Genre shape + a source-grounded role on the section (DET-273). The generator
  // copies shape from the plan and syncs the article section's role from here.
  shape: 'reference',
  sections: [
    {
      heading: 'Storage tiers',
      headingSource: 'original',
      sectionRole: 'referenceEntry',
      sourceBlockIds: ['b1'],
      allowedTransformations: ['grammar_cleanup'],
    },
  ],
  removedBlocks: [],
  warnings: [],
  reorderings: [],
}

const blocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Storage tiers',
    removable: false,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Intro paragraph that is fairly long so the preview can be sliced.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'TABLE',
    classification: 'CORE',
    text: 'Tier | Cost\nHot | $1',
    removable: false,
  },
  {
    id: 'b4',
    type: 'LIST',
    classification: 'CORE',
    text: '1. one\n2. two',
    removable: false,
  },
  {
    id: 'bX',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'removable noise',
    removable: true,
  },
]

/** A valid typed-block v2 LLM response (no schemaVersion / later-wave fields). */
function validLlmArticle() {
  return {
    mode: 'source_preserving_article',
    title: { text: 'Storage tiers', source: 'original' },
    abstract: [
      {
        id: 'a1',
        text: 'A faithful summary.',
        sourceBlockIds: ['b2'],
        transformationType: 'light_reword',
        fidelityRisk: 'low',
      },
    ],
    sections: [
      {
        id: 's1',
        heading: 'Storage tiers',
        headingSource: 'original',
        headingSourceBlockIds: ['b1'],
        // The model proposes its OWN role; the service overwrites it from the
        // plan ('referenceEntry'), proving the plan is the role authority.
        sectionRole: 'claim',
        sourceBlockIds: ['b1', 'b2', 'b3', 'b4'],
        blocks: [
          {
            id: 'p1',
            type: 'paragraph',
            text: 'Intro paragraph.',
            sourceBlockIds: ['b2'],
            transformationType: 'grammar_cleanup',
            fidelityRisk: 'low',
          },
          {
            id: 't1',
            type: 'table',
            header: ['Tier', 'Cost'],
            rows: [['Hot', '$1']],
            sourceBlockIds: ['b3'],
            transformationType: 'formatting_only',
            fidelityRisk: 'low',
          },
          {
            id: 'l1',
            type: 'list',
            ordered: true,
            items: ['one', 'two'],
            sourceBlockIds: ['b4'],
            transformationType: 'formatting_only',
            fidelityRisk: 'low',
          },
        ],
      },
    ],
    keyTerms: [],
    sourceExamples: [],
    caveats: [],
    // Forward-reserved later-wave fields the model must NOT own; even if present,
    // they are dropped because the LLM schema cannot carry them. The injected
    // `shape` here is DIFFERENT from the plan's ('procedure' vs the plan's
    // 'reference') so the test proves the article's shape comes from the PLAN, not
    // the model.
    schemaVersion: 'v2',
    readingAids: { readingTimeMinutes: 9 },
    shape: 'procedure',
    reorderings: [{ sourceBlockId: 'b2', fromIndex: 0, toIndex: 1 }],
  }
}

describe('ArticleGeneratorService', () => {
  it('repairs benign LLM drift instead of failing the article (regression: the FAILED url article)', async () => {
    // The reported failure: an empty subtitle, plus a container section that
    // carries subsections with no ids and no blocks of its own. Pre-repair this
    // FAILED zod validation after one retry; the repair hook normalizes the shape.
    const drifted = validLlmArticle() as Record<string, unknown>
    drifted.subtitle = { text: '', source: 'original', sourceBlockIds: [] }
    const driftedSections = drifted.sections as unknown[]
    driftedSections.push({
      heading: 'Why it works',
      headingSource: 'original',
      sourceBlockIds: ['b1'],
      subsections: [
        { heading: 'Sub A', headingSource: 'original', sourceBlockIds: ['b2'] },
        { heading: 'Sub B', headingSource: 'original', sourceBlockIds: ['b2'] },
      ],
    })

    const article = await makeService(drifted).generate(plan, blocks)

    // Empty subtitle dropped; the container section got an id + empty blocks;
    // each subsection got an id — so the article is produced, not FAILED.
    expect(article.subtitle).toBeUndefined()
    const container = article.sections[1]
    expect(container.id.length).toBeGreaterThan(0)
    expect(container.blocks).toEqual([])
    for (const sub of container.subsections ?? []) {
      expect(sub.id.length).toBeGreaterThan(0)
    }
  })

  it('stamps schemaVersion v2 in code, re-derives originalStructure, strips later-wave fields', async () => {
    const service = makeService(validLlmArticle())
    const article = await service.generate(plan, blocks)

    expect(article.schemaVersion).toBe('v2')
    // readingAids/calloutPlacements/reorderings are owned by other waves and are
    // NOT carried into the generated artifact.
    expect(article.readingAids).toBeUndefined()
    expect(article.reorderings).toBeUndefined()
    expect(article.calloutPlacements).toBeUndefined()

    // GENRE shape (DET-273) is COPIED FROM THE PLAN in code — NOT from the model.
    // The model injected shape 'procedure'; the plan's 'reference' wins.
    expect(article.shape).toBe('reference')

    // The section role is SYNCED FROM THE PLAN ('referenceEntry'), overwriting
    // the role the model proposed on the section ('claim').
    expect(article.sections[0].sectionRole).toBe('referenceEntry')

    // originalStructure is re-derived deterministically from KEPT blocks in order
    // (removable bX excluded), never trusted from the model.
    expect(article.originalStructure.map((o) => o.blockId)).toEqual([
      'b1',
      'b2',
      'b3',
      'b4',
    ])
    expect(article.originalStructure[2]).toMatchObject({ blockType: 'TABLE' })

    // The typed blocks survive intact.
    const types = article.sections[0].blocks.map((b) => b.type)
    expect(types).toEqual(['paragraph', 'table', 'list'])
  })

  it('prunes a block whose only source id is invented, rather than FAILing (DET-319)', async () => {
    const bad = validLlmArticle()
    bad.sections[0].blocks[1].sourceBlockIds = ['ghost'] // the TABLE block
    const service = makeService(bad)

    // Traceability repair drops the untraceable block before assertKnownIds, so
    // the article still generates with its traceable blocks intact.
    const article = await service.generate(plan, blocks)
    const types = article.sections[0].blocks.map((b) => b.type)
    expect(types).toEqual(['paragraph', 'list'])
  })

  it('prunes an invented id from a nested subsection block, keeping the subsection (DET-319)', async () => {
    const bad = validLlmArticle()
    // @ts-expect-error — test injects a subsection with an unknown id.
    bad.sections[0].subsections = [
      {
        id: 'sub1',
        heading: 'Sub',
        headingSource: 'original',
        sourceBlockIds: ['b2'],
        blocks: [
          {
            id: 'sp1',
            type: 'paragraph',
            text: 'Nested.',
            sourceBlockIds: ['nope'],
            transformationType: 'verbatim',
            fidelityRisk: 'low',
          },
        ],
      },
    ]
    const service = makeService(bad)

    // The repair walks subsections: the subsection's own id (b2) is valid so it
    // survives, but its untraceable block is dropped — no loud FAIL.
    const article = await service.generate(plan, blocks)
    expect(article.sections[0].subsections?.[0].blocks).toEqual([])
  })

  it('stamps reorderings from the plan and ignores any the LLM injected (DET-275)', async () => {
    // The plan declares an audited move; the LLM injects a DIFFERENT reorderings
    // array (validLlmArticle sets sourceBlockId 'b2'). The article must carry the
    // PLAN's audit, never the model's.
    const planWithReorder: ReshapingPlan = {
      ...plan,
      reorderings: [
        {
          sourceBlockId: 'b1',
          fromIndex: 0,
          toIndex: 2,
          reason: 'moved for readability',
          risk: 'low',
        },
      ],
    }
    const service = makeService(validLlmArticle())
    const article = await service.generate(planWithReorder, blocks)
    expect(article.reorderings).toEqual(planWithReorder.reorderings)
    expect(article.reorderings?.[0].sourceBlockId).toBe('b1')
  })

  it('omits reorderings when the plan declares none (DET-275)', async () => {
    // The LLM injects reorderings but the plan has none → the field is omitted.
    const service = makeService(validLlmArticle())
    const article = await service.generate(plan, blocks)
    expect(article.reorderings).toBeUndefined()
  })

  it('drops a model-proposed role when the plan assigns none (DET-273)', async () => {
    // Plan with NO sectionRole on its section → the article must NOT carry the
    // role the model tried to set.
    const planNoRole: ReshapingPlan = {
      ...plan,
      shape: 'explainer',
      sections: [{ ...plan.sections[0], sectionRole: undefined }],
    }
    const service = makeService(validLlmArticle())
    const article = await service.generate(planNoRole, blocks)

    expect(article.shape).toBe('explainer')
    expect(article.sections[0].sectionRole).toBeUndefined()
  })
})

describe('ArticleGeneratorService completeness (DET-252 follow-up)', () => {
  const covPlan: ReshapingPlan = {
    titleProposal: { text: 'T', source: 'inferred' },
    shape: 'explainer',
    sections: [
      {
        heading: 'H',
        headingSource: 'inferred',
        headingInferenceReason: 'no headings',
        sourceBlockIds: ['c1', 'c2'],
        allowedTransformations: [],
      },
    ],
    removedBlocks: [],
    warnings: [],
    reorderings: [],
  }
  const covBlocks: ClassifiedBlockInput[] = [
    {
      id: 'c1',
      type: 'PARAGRAPH',
      classification: 'CORE',
      text: 'first',
      removable: false,
    },
    {
      id: 'c2',
      type: 'PARAGRAPH',
      classification: 'CORE',
      text: 'second source text',
      removable: false,
    },
    {
      id: 'c9',
      type: 'PARAGRAPH',
      classification: 'FOOTER',
      text: 'noise',
      removable: true,
    },
  ]

  it('backstops a non-removable block the model dropped, verbatim', async () => {
    // The model renders only c1 — dropping c2 (which the plan assigned).
    const service = makeService({
      mode: 'source_preserving_article',
      title: { text: 'T', source: 'inferred' },
      abstract: [],
      sections: [
        {
          id: 's1',
          heading: 'H',
          headingSource: 'inferred',
          sourceBlockIds: ['c1'],
          blocks: [
            {
              id: 'p1',
              type: 'paragraph',
              sourceBlockIds: ['c1'],
              transformationType: 'verbatim',
              fidelityRisk: 'low',
              text: 'first',
            },
          ],
        },
      ],
      keyTerms: [],
      sourceExamples: [],
      caveats: [],
    })
    const article = await service.generate(covPlan, covBlocks)
    const cited = new Set(
      article.sections
        .flatMap((s) => s.blocks)
        .flatMap((b) => b.sourceBlockIds),
    )
    expect(cited.has('c2')).toBe(true) // dropped block recovered
    expect(cited.has('c9')).toBe(false) // removable noise is never added
    const cover = article.sections
      .flatMap((s) => s.blocks)
      .find((b) => b.sourceBlockIds.includes('c2'))
    expect(cover?.transformationType).toBe('verbatim')
    expect((cover as { text?: string }).text).toBe('second source text')
  })
})
