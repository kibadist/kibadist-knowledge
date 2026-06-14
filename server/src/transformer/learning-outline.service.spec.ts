import type { AiService } from '../ai/ai.service'
import { LearningOutlineService } from './learning-outline.service'
import type { ClassifiedBlockInput } from './structure-model.service'

function makeService(outlineResponse: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(outlineResponse), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return { service: new LearningOutlineService(ai), complete }
}

// --- Transcript fixture (acceptance: a coherent lesson outline) -------------
// A headingless spoken transcript: b1 is filler (removable), b2..b4 are content.
const transcriptBlocks: ClassifiedBlockInput[] = [
  {
    id: 'b1',
    type: 'PARAGRAPH',
    classification: 'NOISE',
    text: 'Um, okay, hi.',
    removable: true,
  },
  {
    id: 'b2',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'We shipped the new onboarding flow this quarter.',
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Activation rose fifteen percent after cutting a signup step.',
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Next quarter we simplify the billing screens.',
    removable: false,
  },
]

// --- Systems fixture (acceptance: learning sections + demoted furniture) ----
// A Wikipedia-style "Systems" article: four teachable sections plus References,
// Bibliography and External-links furniture the learning outline must demote.
const systemsBlocks: ClassifiedBlockInput[] = [
  {
    id: 'h1',
    type: 'HEADING',
    classification: 'CORE',
    text: 'What Is a System',
    headingLevel: 2,
    removable: false,
  },
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
    classification: 'CORE',
    text: 'Its behaviour emerges from the interactions, not the parts alone.',
    removable: false,
  },
  {
    id: 'h2',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Boundaries and Environment',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 'b3',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A boundary separates a system from its environment.',
    removable: false,
  },
  {
    id: 'h3',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Open, Closed, and Isolated Systems',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 'b4',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'Open systems exchange matter and energy; isolated systems exchange neither.',
    removable: false,
  },
  {
    id: 'h4',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Systems as Transformations',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 'b5',
    type: 'PARAGRAPH',
    classification: 'CORE',
    text: 'A system transforms inputs into outputs over time.',
    removable: false,
  },
  {
    id: 'h5',
    type: 'HEADING',
    classification: 'CORE',
    text: 'References',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 'b6',
    type: 'PARAGRAPH',
    classification: 'CITATION',
    text: '[1] Bertalanffy, General System Theory.',
    removable: false,
  },
  {
    id: 'h6',
    type: 'HEADING',
    classification: 'CORE',
    text: 'Bibliography',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 'b7',
    type: 'PARAGRAPH',
    classification: 'CITATION',
    text: 'Meadows, Thinking in Systems.',
    removable: false,
  },
  {
    id: 'h7',
    type: 'HEADING',
    classification: 'CORE',
    text: 'External links',
    headingLevel: 2,
    removable: false,
  },
  {
    id: 'b8',
    type: 'PARAGRAPH',
    classification: 'CITATION',
    text: 'http://example.org/systems',
    removable: false,
  },
]

describe('LearningOutlineService — transcript', () => {
  it('produces a coherent lesson outline (grouped sections), not isolated sentence headings', async () => {
    const { service } = makeService({
      title: { text: 'Quarterly product update', source: 'inferred' },
      learningPath: [
        {
          step: 1,
          outcome: 'Know what shipped',
          sectionHeadings: ['What shipped'],
        },
        {
          step: 2,
          outcome: 'Know what is next',
          sectionHeadings: ["What's next"],
        },
      ],
      sections: [
        {
          heading: 'What shipped',
          headingSource: 'inferred',
          headingInferenceReason: 'transcript has no headings',
          sectionRole: 'concept',
          sourceSegmentIds: ['seg1'],
          sourceBlockIds: ['b2', 'b3'],
          conceptFocus: 'the onboarding change and its impact',
          requiredClaims: ['onboarding shipped', 'activation rose 15%'],
          targetReaderOutcome: 'Understand what shipped and why it mattered',
        },
        {
          heading: "What's next",
          headingSource: 'inferred',
          headingInferenceReason: 'transcript has no headings',
          sectionRole: 'summary',
          sourceSegmentIds: ['seg1'],
          sourceBlockIds: ['b4'],
          conceptFocus: 'the next quarter plan',
          requiredClaims: ['billing simplification next'],
          targetReaderOutcome: 'Know the next priority',
        },
      ],
      sourceNotesPlan: { notes: [] },
      calloutPlan: [],
      tablePlan: [],
      reorderings: [],
      warnings: [],
    })

    const outline = await service.build({
      sourceKind: 'transcript',
      articleShape: 'lesson_article',
      blocks: transcriptBlocks,
    })

    expect(outline.articleShape).toBe('lesson_article')
    expect(outline.sourceKind).toBe('transcript')
    // Two coherent sections over three content sentences — NOT one heading each.
    expect(outline.sections).toHaveLength(2)
    expect(outline.sections.length).toBeLessThan(
      transcriptBlocks.filter((b) => !b.removable).length,
    )
    // The first section groups multiple source blocks (a real lesson section).
    expect(outline.sections[0].sourceBlockIds.length).toBeGreaterThan(1)
    expect(outline.learningPath).toHaveLength(2)
  })
})

describe('LearningOutlineService — systems', () => {
  it('keeps learning sections and demotes references / bibliography / external links to source notes', async () => {
    const { service } = makeService({
      title: { text: 'System', source: 'cleanedOriginal' },
      learningPath: [],
      sections: [
        {
          heading: 'What Is a System',
          headingSource: 'original',
          sectionRole: 'definition',
          sourceSegmentIds: ['seg1'],
          sourceBlockIds: ['h1', 'b1', 'b2'],
          conceptFocus: 'definition of a system',
          requiredClaims: ['a system is interacting parts'],
          targetReaderOutcome: 'Define a system',
        },
        {
          heading: 'Boundaries and Environment',
          headingSource: 'original',
          sectionRole: 'boundaries',
          sourceSegmentIds: ['seg2'],
          sourceBlockIds: ['h2', 'b3'],
          conceptFocus: 'system boundary',
          requiredClaims: ['a boundary separates system from environment'],
          targetReaderOutcome: 'Identify a system boundary',
        },
        {
          heading: 'Open, Closed, and Isolated Systems',
          headingSource: 'original',
          sectionRole: 'types',
          sourceSegmentIds: ['seg3'],
          sourceBlockIds: ['h3', 'b4'],
          conceptFocus: 'kinds of systems',
          requiredClaims: ['open vs isolated systems'],
          targetReaderOutcome: 'Classify systems by exchange',
        },
        {
          heading: 'Systems as Transformations',
          headingSource: 'original',
          sectionRole: 'mechanism',
          sourceSegmentIds: ['seg4'],
          sourceBlockIds: ['h4', 'b5'],
          conceptFocus: 'input-output transformation',
          requiredClaims: ['a system transforms inputs into outputs'],
          targetReaderOutcome: 'Model a system as a transformation',
        },
        {
          // The model WRONGLY keeps References as a body section — the service
          // must demote it to source notes.
          heading: 'References',
          headingSource: 'original',
          sectionRole: 'sourceNotes',
          sourceSegmentIds: ['seg5'],
          sourceBlockIds: ['h5', 'b6'],
          conceptFocus: 'references',
          requiredClaims: [],
          targetReaderOutcome: 'See the sources',
        },
      ],
      sourceNotesPlan: { notes: [] },
      calloutPlan: [],
      tablePlan: [],
      reorderings: [],
      warnings: [],
    })

    const outline = await service.build({
      sourceKind: 'encyclopedia',
      articleShape: 'concept_explainer',
      blocks: systemsBlocks,
    })

    expect(outline.sections.map((s) => s.heading)).toEqual([
      'What Is a System',
      'Boundaries and Environment',
      'Open, Closed, and Isolated Systems',
      'Systems as Transformations',
    ])
    // References, Bibliography and External links are all planned as source notes.
    const noteKinds = outline.sourceNotesPlan.notes.map((n) => n.kind).sort()
    expect(noteKinds).toEqual(['bibliography', 'externalLinks', 'references'])
    expect(
      outline.warnings.some((w) => /Demoted section "References"/.test(w)),
    ).toBe(true)
  })
})

describe('LearningOutlineService — guards', () => {
  it('prunes a section whose only citation is hallucinated, keeping the valid one', async () => {
    const { service } = makeService({
      title: { text: 'T', source: 'inferred' },
      learningPath: [],
      sections: [
        {
          heading: 'Real',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'concept',
          sourceSegmentIds: ['seg1'],
          sourceBlockIds: ['b2'],
          conceptFocus: 'f',
          requiredClaims: [],
          targetReaderOutcome: 'o',
        },
        {
          heading: 'Ghost',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'concept',
          sourceSegmentIds: ['ghost-seg'],
          sourceBlockIds: ['ghost'],
          conceptFocus: 'f',
          requiredClaims: [],
          targetReaderOutcome: 'o',
        },
      ],
      sourceNotesPlan: { notes: [] },
      calloutPlan: [],
      tablePlan: [],
      reorderings: [],
      warnings: [],
    })
    const outline = await service.build({
      sourceKind: 'transcript',
      articleShape: 'lesson_article',
      blocks: transcriptBlocks,
    })
    expect(outline.sections.map((s) => s.heading)).toEqual(['Real'])
  })

  it('throws when no section has a traceable source reference', async () => {
    const { service } = makeService({
      title: { text: 'T', source: 'inferred' },
      learningPath: [],
      sections: [
        {
          heading: 'Ghost',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'concept',
          sourceSegmentIds: ['ghost-seg'],
          sourceBlockIds: ['ghost'],
          conceptFocus: 'f',
          requiredClaims: [],
          targetReaderOutcome: 'o',
        },
      ],
      sourceNotesPlan: { notes: [] },
      calloutPlan: [],
      tablePlan: [],
      reorderings: [],
      warnings: [],
    })
    await expect(
      service.build({
        sourceKind: 'transcript',
        articleShape: 'lesson_article',
        blocks: transcriptBlocks,
      }),
    ).rejects.toThrow(/no section with a traceable/i)
  })

  it('warns when a section is reordered without recording the move', async () => {
    // Two content segments read in reverse source order with no reorderings entry.
    const { service } = makeService({
      title: { text: 'T', source: 'inferred' },
      learningPath: [],
      sections: [
        {
          heading: 'Second first',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'concept',
          sourceSegmentIds: ['seg1'],
          sourceBlockIds: ['b4'],
          conceptFocus: 'f',
          requiredClaims: [],
          targetReaderOutcome: 'o',
        },
        {
          heading: 'First second',
          headingSource: 'inferred',
          headingInferenceReason: 'no heading',
          sectionRole: 'concept',
          sourceSegmentIds: ['seg1'],
          sourceBlockIds: ['b2'],
          conceptFocus: 'f',
          requiredClaims: [],
          targetReaderOutcome: 'o',
        },
      ],
      sourceNotesPlan: { notes: [] },
      calloutPlan: [],
      tablePlan: [],
      reorderings: [],
      warnings: [],
    })
    const outline = await service.build({
      sourceKind: 'transcript',
      articleShape: 'lesson_article',
      blocks: transcriptBlocks,
    })
    expect(outline.warnings.some((w) => /unaudited reorder/i.test(w))).toBe(
      true,
    )
  })
})
