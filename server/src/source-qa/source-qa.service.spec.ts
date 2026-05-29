import { AnswerKind, QuestionActor } from '@kibadist/prisma'
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { SourceQaService } from './source-qa.service'

function makeService() {
  const prisma = {
    concept: { findFirst: jest.fn() },
    sourceQuestion: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  }
  const ai = { complete: jest.fn() }
  const service = new SourceQaService(prisma as never, ai as never)
  return { service, prisma, ai }
}

/** A minimal valid SourceDocument for test fixtures. */
const SOURCE_DOC = {
  version: 1,
  blocks: [
    {
      id: 'b_abc123',
      type: 'paragraph',
      runs: [{ text: 'Spaced repetition is an evidence-based technique.' }],
    },
  ],
  extractor: 'text-markdown@1',
  degraded: false,
}

const INBOX_TEXT_ONLY = {
  id: 'c1',
  sourceText: 'The source explains spaced repetition and its evidence base.',
  sourceDocument: null,
}

const INBOX_WITH_DOC = {
  id: 'c1',
  sourceText: 'The source explains spaced repetition.',
  sourceDocument: SOURCE_DOC,
}

describe('SourceQaService.ask', () => {
  it('persists an AI answer as un-promotable REFERENCE_SCAFFOLD (sourceText fallback)', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_TEXT_ONLY)
    ai.complete.mockResolvedValue({
      text: '{"answer": "The source says X.", "citations": [{"quote":"X is true"}]}',
      model: 'test',
    })
    prisma.sourceQuestion.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'q1',
          createdAt: new Date(),
          citations: data.citations,
          ...data,
        }),
    )

    const out = await service.ask('u1', 'c1', { questionText: 'What is X?' })

    // The stored provenance is the structural guarantee.
    const created = prisma.sourceQuestion.create.mock.calls[0][0].data
    expect(created.askedBy).toBe(QuestionActor.USER)
    expect(created.answeredBy).toBe(QuestionActor.AI)
    expect(created.answerKind).toBe(AnswerKind.REFERENCE_SCAFFOLD)
    expect(created.questionText).toBe('What is X?')
    expect(created.answerText).toBe('The source says X.')
    // Citations are now ReferenceCitation objects
    expect(created.citations).toEqual([{ quote: 'X is true' }])

    expect(out.answerKind).toBe(AnswerKind.REFERENCE_SCAFFOLD)
    expect(out.citations).toEqual([{ quote: 'X is true' }])
  })

  it('uses structured document when sourceDocument is valid and passes block-id context to AI', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_WITH_DOC)
    ai.complete.mockResolvedValue({
      text: '{"answer":"Structured answer.","citations":[{"quote":"evidence-based","blockId":"b_abc123"}]}',
      model: 'test',
    })
    prisma.sourceQuestion.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'q2',
          createdAt: new Date(),
          citations: data.citations,
          ...data,
        }),
    )

    const out = await service.ask('u1', 'c1', {
      questionText: 'What technique?',
    })

    // The AI prompt must have received block-id annotated context (b_ token)
    const aiCallArgs = ai.complete.mock.calls[0][0]
    expect(aiCallArgs.prompt).toMatch(/b_/)

    // Citations carry blockId
    expect(out.citations).toEqual([
      { quote: 'evidence-based', blockId: 'b_abc123' },
    ])
  })

  it('falls back to sourceText when sourceDocument is null', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_TEXT_ONLY)
    ai.complete.mockResolvedValue({
      text: '{"answer":"Fallback answer.","citations":[]}',
      model: 'test',
    })
    prisma.sourceQuestion.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'q3',
          createdAt: new Date(),
          citations: data.citations,
          ...data,
        }),
    )

    await service.ask('u1', 'c1', { questionText: 'q' })

    // When falling back to plain text, prompt should contain the raw source text
    const aiCallArgs = ai.complete.mock.calls[0][0]
    expect(aiCallArgs.prompt).toContain('spaced repetition')
  })

  it('rejects asking about an item with no source text', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({
      id: 'c1',
      sourceText: '   ',
      sourceDocument: null,
    })
    await expect(
      service.ask('u1', 'c1', { questionText: 'q' }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(ai.complete).not.toHaveBeenCalled()
    expect(prisma.sourceQuestion.create).not.toHaveBeenCalled()
  })

  it('404s on a foreign / non-inbox concept', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue(null)
    await expect(
      service.ask('u1', 'c1', { questionText: 'q' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(ai.complete).not.toHaveBeenCalled()
  })

  it('does not persist anything when the AI call fails', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue(INBOX_TEXT_ONLY)
    ai.complete.mockRejectedValue(new Error('provider down'))
    await expect(
      service.ask('u1', 'c1', { questionText: 'q' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(prisma.sourceQuestion.create).not.toHaveBeenCalled()
  })
})

describe('SourceQaService.recentForContext', () => {
  it('returns answered pairs oldest-first for downstream prompts', async () => {
    const { service, prisma } = makeService()
    // Service queries newest-first, then reverses to oldest-first.
    prisma.sourceQuestion.findMany.mockResolvedValue([
      { questionText: 'q2', answerText: 'a2' },
      { questionText: 'q1', answerText: 'a1' },
    ])
    const out = await service.recentForContext('u1', 'c1')
    expect(out).toEqual([
      { questionText: 'q1', answerText: 'a1' },
      { questionText: 'q2', answerText: 'a2' },
    ])
    // Only answered rows are eligible as context.
    expect(prisma.sourceQuestion.findMany.mock.calls[0][0].where).toMatchObject(
      {
        conceptId: 'c1',
        userId: 'u1',
        answerText: { not: null },
      },
    )
  })
})

describe('SourceQaService.remove', () => {
  it('404s when nothing was deleted', async () => {
    const { service, prisma } = makeService()
    prisma.sourceQuestion.deleteMany.mockResolvedValue({ count: 0 })
    await expect(service.remove('u1', 'q1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('scopes deletion by owner', async () => {
    const { service, prisma } = makeService()
    prisma.sourceQuestion.deleteMany.mockResolvedValue({ count: 1 })
    await service.remove('u1', 'q1')
    expect(prisma.sourceQuestion.deleteMany).toHaveBeenCalledWith({
      where: { id: 'q1', userId: 'u1' },
    })
  })
})
