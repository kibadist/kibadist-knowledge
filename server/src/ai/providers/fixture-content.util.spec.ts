import {
  buildClassificationPrompt,
  ClassificationResponseSchema,
} from '../../transformer/block-classifier.prompt'
import { evaluateQualityGate } from '../../transformer/v3/quality-gate.util'
import { assembleArticleV3 } from '../../transformer/v3/v3-assembly.util'
import type { CoverageBlockV3 } from '../../transformer/v3/v3-coverage.util'
import {
  buildLearningPrompt,
  buildRewritePrompt,
  type V3PromptBlock,
} from '../../transformer/v3/v3-generator.prompt'
import {
  V3LearningLlmSchema,
  V3RewriteLlmSchema,
} from '../../transformer/v3/v3-schemas'
import {
  classifyBlock,
  detectCallKind,
  parseBlocks,
  synthesizeClassification,
  synthesizeCompletion,
  synthesizeLearning,
  synthesizeRewrite,
} from './fixture-content.util'

/**
 * These tests prove the fixture provider closes the keyless-verification gap: its
 * deterministic output, when run through the REAL v3 assembly + quality gate,
 * produces a READY_FOR_REVIEW article with grounded concepts/claims/prompts and 0
 * unsupported claims — i.e. the acceptance criteria are observable with no key.
 */

// A small but realistic transcript-shaped source: a heading, a definition, an
// example, an argument, and a noise line.
const TRANSCRIPT_BLOCKS: V3PromptBlock[] = [
  {
    id: 'b1',
    blockType: 'heading',
    classification: 'BACKGROUND',
    text: 'Spaced repetition',
  },
  {
    id: 'b2',
    blockType: 'paragraph',
    classification: 'DEFINITION',
    text: 'Spaced repetition is a learning technique that reviews material at increasing intervals to fight forgetting.',
  },
  {
    id: 'b3',
    blockType: 'paragraph',
    classification: 'EXAMPLE',
    text: 'For example, you might review a flashcard after one day, then three days, then a week.',
  },
  {
    id: 'b4',
    blockType: 'paragraph',
    classification: 'MAIN_ARGUMENT',
    text: 'Reviewing just before you would forget produces the strongest long-term retention.',
  },
  {
    id: 'b5',
    blockType: 'paragraph',
    classification: 'EVIDENCE',
    text: 'Studies show retention improves by roughly 200% versus massed practice.',
  },
]

function coverageBlocks(blocks: V3PromptBlock[]): CoverageBlockV3[] {
  return blocks.map((b) => ({
    id: b.id,
    classification: b.classification,
    removable: false,
  }))
}

describe('fixture-content parseBlocks', () => {
  it('parses v3 block lines (id/type/classification/text)', () => {
    const { prompt } = buildRewritePrompt(TRANSCRIPT_BLOCKS, 'transcript')
    const parsed = parseBlocks(prompt)
    expect(parsed.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
    expect(parsed[1]).toMatchObject({
      id: 'b2',
      blockType: 'paragraph',
      classification: 'DEFINITION',
    })
    expect(parsed[1].text).toContain(
      'Spaced repetition is a learning technique',
    )
  })

  it('parses classifier block lines (numeric index/type, no classification)', () => {
    const { prompt } = buildClassificationPrompt([
      { index: 0, blockType: 'heading', text: 'Intro' },
      { index: 1, blockType: 'paragraph', text: 'A claim about the world.' },
    ])
    const parsed = parseBlocks(prompt)
    expect(parsed.map((b) => b.id)).toEqual(['0', '1'])
    expect(parsed[0].classification).toBeNull()
  })
})

describe('fixture-content classifyBlock', () => {
  it('assigns substance classes that make coverage/concepts meaningful', () => {
    expect(classifyBlock('heading', 'A Heading')).toBe('BACKGROUND')
    expect(
      classifyBlock(
        'paragraph',
        'Spaced repetition is a technique for learning.',
      ),
    ).toBe('DEFINITION')
    expect(
      classifyBlock('paragraph', 'For example, review after one day.'),
    ).toBe('EXAMPLE')
    expect(
      classifyBlock('paragraph', 'Studies show a 30% improvement in recall.'),
    ).toBe('EVIDENCE')
    expect(classifyBlock('paragraph', 'Short')).toBe('UNCERTAIN')
  })

  it('marks obvious chrome removable', () => {
    expect(
      classifyBlock('paragraph', '© 2026 ACME. All rights reserved.'),
    ).toBe('NAVIGATION_NOISE')
  })
})

describe('fixture-content classification response', () => {
  it('emits a schema-valid classification per block index', () => {
    const { prompt } = buildClassificationPrompt([
      { index: 0, blockType: 'heading', text: 'Spaced repetition' },
      {
        index: 1,
        blockType: 'paragraph',
        text: 'Spaced repetition is a learning technique that fights forgetting.',
      },
    ])
    const json = JSON.parse(synthesizeClassification(prompt))
    const parsed = ClassificationResponseSchema.parse(json)
    expect(parsed.classifications).toHaveLength(2)
    expect(parsed.classifications[1].classification).toBe('DEFINITION')
  })
})

describe('fixture-content rewrite + learning are schema-valid', () => {
  it('produces a schema-valid rewrite citing real ids', () => {
    const { prompt } = buildRewritePrompt(TRANSCRIPT_BLOCKS, 'transcript')
    const rewrite = V3RewriteLlmSchema.parse(
      JSON.parse(synthesizeRewrite(prompt)),
    )
    const citedIds = rewrite.sections.flatMap((s) =>
      s.blocks.flatMap((b) => b.sourceBlockIds),
    )
    expect(citedIds).toEqual(expect.arrayContaining(['b2', 'b3', 'b4', 'b5']))
  })

  it('produces a schema-valid learning layer with grounded concepts/claims/prompts', () => {
    const { prompt } = buildLearningPrompt(TRANSCRIPT_BLOCKS, 'transcript')
    const learning = V3LearningLlmSchema.parse(
      JSON.parse(synthesizeLearning(prompt)),
    )
    expect(learning.keyConcepts.length).toBeGreaterThan(0)
    expect(learning.keyClaims.length).toBeGreaterThan(0)
    expect(learning.retrievalPrompts.length).toBeGreaterThan(0)
    for (const c of learning.keyConcepts) {
      expect(c.sourceBlockIds.length).toBeGreaterThan(0)
    }
  })
})

describe('fixture-content end-to-end through the REAL v3 machinery', () => {
  it('a transcript fixture run is READY_FOR_REVIEW with ≥80% coverage and grounded learning', () => {
    const rewritePrompt = buildRewritePrompt(TRANSCRIPT_BLOCKS, 'transcript')
    const learningPrompt = buildLearningPrompt(TRANSCRIPT_BLOCKS, 'transcript')

    const rewrite = V3RewriteLlmSchema.parse(
      JSON.parse(synthesizeRewrite(rewritePrompt.prompt)),
    )
    const learning = V3LearningLlmSchema.parse(
      JSON.parse(synthesizeLearning(learningPrompt.prompt)),
    )
    const known = new Set(TRANSCRIPT_BLOCKS.map((b) => b.id))

    const article = assembleArticleV3(rewrite, learning, 'transcript', known)
    const report = evaluateQualityGate(
      article,
      coverageBlocks(TRANSCRIPT_BLOCKS),
    )

    expect(report.status).toBe('READY_FOR_REVIEW')
    expect(report.importantCoveragePercent).toBeGreaterThanOrEqual(80)
    expect(report.unsupportedClaimCount).toBe(0)
    expect(report.conceptCandidateCount).toBeGreaterThan(0)
    expect(report.retrievalPromptCount).toBeGreaterThan(0)
    expect(report.blockers.filter((b) => b.severity === 'hard')).toHaveLength(0)
    // Some blocks are genuinely source-grounded (provenance reflects real ids).
    expect(article.provenance.sourceGroundedBlocks).toBeGreaterThan(0)
  })
})

describe('fixture-content call routing', () => {
  it('detects the call kind from the system prompt', () => {
    const cls = buildClassificationPrompt([
      { index: 0, blockType: 'paragraph', text: 'x' },
    ])
    const rw = buildRewritePrompt(TRANSCRIPT_BLOCKS, 'transcript')
    const ln = buildLearningPrompt(TRANSCRIPT_BLOCKS, 'transcript')
    expect(detectCallKind(cls.system)).toBe('classification')
    expect(detectCallKind(rw.system)).toBe('v3_rewrite')
    expect(detectCallKind(ln.system)).toBe('v3_learning')
    expect(detectCallKind('something else')).toBe('unknown')
  })

  it('synthesizeCompletion returns {} for unrecognised calls', () => {
    expect(synthesizeCompletion('unknown system', 'whatever')).toBe('{}')
  })
})
