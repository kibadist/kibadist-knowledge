import { makeV3Article } from './__fixtures__/v3-fixtures'
import { ArticlePipelineV3Service } from './article-pipeline-v3.service'
import type { V3AssemblyMeta } from './v3-assembly.util'
import type {
  V3GeneratorBlock,
  V3GeneratorService,
} from './v3-generator.service'

const META: V3AssemblyMeta = {
  sourceKind: 'transcript_lesson',
  shape: 'lesson_article',
}

// One important DEFINITION block ⇒ a transcript needs ≥80% coverage AND a concept.
const BLOCKS: V3GeneratorBlock[] = [
  {
    id: 'b1',
    blockType: 'PARAGRAPH',
    classification: 'DEFINITION',
    removable: false,
    text: 'A spaced repetition schedule.',
  },
]

const concept = {
  id: 'concept-0',
  name: 'X',
  normalizedName: 'x',
  type: 'core_concept' as const,
  sourceBlockIds: ['b1'],
  articleSectionIds: ['sec-0'],
  importance: 'high' as const,
  suggestedCognitiveState: 'Parsed' as const,
}

function grounded(status: 'READY_FOR_REVIEW' | 'BLOCKED_LOW_COVERAGE') {
  // Cites b1 ⇒ 100% coverage; has a concept + a prompt ⇒ gate passes.
  return makeV3Article({
    status,
    sourceKind: 'transcript_lesson',
    keyConcepts: [concept],
  })
}

function lowCoverage(status: 'BLOCKED_LOW_COVERAGE') {
  // Cites nothing real anywhere (body, concept, prompt) ⇒ b1 missing ⇒ low
  // coverage. A concept still EXISTS (count > 0) so missing_concepts never fires —
  // low_coverage is the sole, addressable blocker.
  return makeV3Article({
    status,
    sourceKind: 'transcript_lesson',
    keyConcepts: [{ ...concept, sourceBlockIds: [], articleSectionIds: [] }],
    retrievalPrompts: [
      {
        id: 'prompt-0',
        question: 'Q?',
        expectedAnswerSourceBlockIds: [],
        relatedConceptCandidateIds: [],
        promptType: 'definition',
        difficulty: 'easy',
        status: 'ai_suggested',
      },
    ],
    sections: [
      {
        id: 'sec-0',
        heading: 'S',
        sourceBlockIds: [],
        paragraphs: [
          { id: 'sec-0-p-0', text: 'Ungrounded.', sourceBlockIds: [] },
        ],
      },
    ],
  })
}

function makeService(generator: Partial<V3GeneratorService>) {
  return new ArticlePipelineV3Service(generator as V3GeneratorService)
}

describe('ArticlePipelineV3Service (Repair or publish)', () => {
  it('returns the first article when it already passes the gate (no regeneration)', async () => {
    const generate = jest.fn().mockResolvedValue(grounded('READY_FOR_REVIEW'))
    const regenerate = jest.fn()
    const out = await makeService({ generate, regenerate }).run(BLOCKS, META)
    expect(out.status).toBe('READY_FOR_REVIEW')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('runs ONE targeted regeneration when blockers are addressable and keeps a readable second pass', async () => {
    const generate = jest
      .fn()
      .mockResolvedValue(lowCoverage('BLOCKED_LOW_COVERAGE'))
    const regenerate = jest.fn().mockResolvedValue(grounded('READY_FOR_REVIEW'))
    const out = await makeService({ generate, regenerate }).run(BLOCKS, META)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(out.status).toBe('READY_FOR_REVIEW')
  })

  it('does not regenerate when the recomputed gate finds no hard blockers', async () => {
    // status says blocked, but the article actually passes ⇒ no wasted regen.
    const generate = jest
      .fn()
      .mockResolvedValue(grounded('BLOCKED_LOW_COVERAGE'))
    const regenerate = jest.fn()
    const out = await makeService({ generate, regenerate }).run(BLOCKS, META)
    expect(regenerate).not.toHaveBeenCalled()
    expect(out).toBeDefined()
  })

  it('keeps the higher-coverage article when regeneration still fails to pass', async () => {
    const first = lowCoverage('BLOCKED_LOW_COVERAGE')
    const secondWorse = lowCoverage('BLOCKED_LOW_COVERAGE')
    secondWorse.qualityReport.importantSourceCoverageScore = 10
    first.qualityReport.importantSourceCoverageScore = 50
    const generate = jest.fn().mockResolvedValue(first)
    const regenerate = jest.fn().mockResolvedValue(secondWorse)
    const out = await makeService({ generate, regenerate }).run(BLOCKS, META)
    expect(out.qualityReport.importantSourceCoverageScore).toBe(50)
  })
})
