import type { AiService } from '../ai/ai.service'
import { systemsArticle } from './__fixtures__/systems-article'
import { transformerTranscript } from './__fixtures__/transformer-transcript'
import { LearningPromptsService } from './learning-prompts.service'
import { ArticleJsonV2Schema } from './schemas'

/**
 * Golden learning-prompt suite (DET-353). Deterministic recorded artifacts (NO
 * live LLM): each fixture carries the source blocks, the v2 article, the concept
 * candidates, and the RECORDED model reply. We feed the recorded reply through the
 * real `LearningPromptsService` and assert the source-preservation + acceptance
 * invariants hold:
 *  - successful articles generate at least 3 retrieval prompts,
 *  - every retrieval prompt links to a non-empty, real expected-answer source
 *    block set,
 *  - the transformer transcript yields prompts for Q/K/V, MLP, layer norm, the
 *    non-linearity, and activation functions,
 *  - the systems article yields prompts for the system definition, boundaries/
 *    environment, open/closed/isolated systems, and transformation processes,
 *  - misconceptions are source-grounded or clearly marked AI-suggested,
 *  - NOTHING is scheduled permanently — every status starts ai_suggested.
 */

function serviceFor(response: unknown) {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: JSON.stringify(response), model: 'stub' })
  const ai = { complete } as unknown as AiService
  return new LearningPromptsService(ai)
}

type Fixture = typeof transformerTranscript

function inputFor(fixture: Fixture) {
  return {
    article: fixture.article,
    blocks: fixture.blocks,
    conceptCandidates: fixture.conceptCandidates,
    keyClaims: [],
  }
}

/** Lowercased concatenation of every generated question — for keyword coverage. */
function questionsText(questions: { question: string }[]): string {
  return questions.map((q) => q.question.toLowerCase()).join(' \n ')
}

describe.each([
  ['transformer-transcript', transformerTranscript],
  ['systems-article', systemsArticle],
] as const)('learning-prompts golden: %s', (_name, fixture) => {
  const known = new Set(fixture.blocks.map((b) => b.id))
  const knownCandidates = new Set(fixture.conceptCandidates.map((c) => c.id))

  it('the fixture article is a valid v2 article', () => {
    expect(ArticleJsonV2Schema.safeParse(fixture.article).success).toBe(true)
  })

  it('generates at least 3 retrieval prompts when content is sufficient', async () => {
    const out = await serviceFor(fixture.llmResponse).build(inputFor(fixture))
    expect(out.retrievalPrompts.length).toBeGreaterThanOrEqual(3)
  })

  it('links every prompt to a non-empty, real expected-answer source block set', async () => {
    const out = await serviceFor(fixture.llmResponse).build(inputFor(fixture))
    for (const p of out.retrievalPrompts) {
      expect(p.expectedAnswerSourceBlockIds.length).toBeGreaterThan(0)
      for (const id of p.expectedAnswerSourceBlockIds) {
        expect(known.has(id)).toBe(true)
      }
      // Concept-candidate links, when present, reference real candidates only.
      for (const id of p.relatedConceptCandidateIds) {
        expect(knownCandidates.has(id)).toBe(true)
      }
    }
  })

  it('schedules nothing permanently — every status starts ai_suggested', async () => {
    const out = await serviceFor(fixture.llmResponse).build(inputFor(fixture))
    for (const p of out.retrievalPrompts) {
      expect(p.status).toBe('ai_suggested')
    }
    for (const m of out.misconceptions) {
      expect(m.status).toBe('ai_suggested')
    }
  })

  it('keeps misconceptions source-grounded or clearly AI-suggested', async () => {
    const out = await serviceFor(fixture.llmResponse).build(inputFor(fixture))
    for (const m of out.misconceptions) {
      const grounded = m.sourceBlockIds.length > 0
      // Either it cites real source blocks, or it is plainly an AI suggestion.
      expect(grounded || m.status === 'ai_suggested').toBe(true)
      for (const id of m.sourceBlockIds) expect(known.has(id)).toBe(true)
      expect(m.confidence).toBeGreaterThanOrEqual(0)
      expect(m.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('learning-prompts golden: transformer transcript coverage', () => {
  it('generates prompts for Q/K/V, MLP, layer norm, non-linearity, and activation functions', async () => {
    const out = await serviceFor(transformerTranscript.llmResponse).build({
      article: transformerTranscript.article,
      blocks: transformerTranscript.blocks,
      conceptCandidates: transformerTranscript.conceptCandidates,
      keyClaims: [],
    })
    const text = questionsText(out.retrievalPrompts)
    // Q/K/V
    expect(text).toContain('query')
    expect(text).toContain('key')
    expect(text).toContain('value')
    // MLP / feed-forward
    expect(text).toContain('mlp')
    // Layer normalization
    expect(text).toContain('layer normalization')
    // Non-linearity + activation functions
    expect(text).toContain('non-linear')
    expect(text).toContain('activation function')
  })
})

describe('learning-prompts golden: systems article coverage', () => {
  it('generates prompts for system definition, boundaries/environment, open/closed/isolated systems, and transformation processes', async () => {
    const out = await serviceFor(systemsArticle.llmResponse).build({
      article: systemsArticle.article,
      blocks: systemsArticle.blocks,
      conceptCandidates: systemsArticle.conceptCandidates,
      keyClaims: [],
    })
    const text = questionsText(out.retrievalPrompts)
    // System definition
    expect(text).toContain('what is a system')
    // Boundaries / environment
    expect(text).toContain('boundary')
    expect(text).toContain('environment')
    // Open / closed / isolated
    expect(text).toContain('open')
    expect(text).toContain('closed')
    expect(text).toContain('isolated')
    // Transformation processes
    expect(text).toContain('transformation')
  })
})
