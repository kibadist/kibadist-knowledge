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

const INBOX = {
  id: 'c1',
  sourceText: 'The source explains spaced repetition and its evidence base.',
}

describe('SourceQaService.ask', () => {
  it('persists an AI answer as un-promotable REFERENCE_SCAFFOLD', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue(INBOX)
    ai.complete.mockResolvedValue({
      text: '{"answer": "The source says X.", "citations": ["X is true"]}',
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

    // The stored provenance is the structural guarantee: user asked, AI answered,
    // and the answer is scaffold — never a candidate for canonical knowledge.
    const created = prisma.sourceQuestion.create.mock.calls[0][0].data
    expect(created.askedBy).toBe(QuestionActor.USER)
    expect(created.answeredBy).toBe(QuestionActor.AI)
    expect(created.answerKind).toBe(AnswerKind.REFERENCE_SCAFFOLD)
    expect(created.questionText).toBe('What is X?')
    expect(created.answerText).toBe('The source says X.')
    expect(created.citations).toEqual(['X is true'])

    expect(out.answerKind).toBe(AnswerKind.REFERENCE_SCAFFOLD)
    expect(out.citations).toEqual(['X is true'])
  })

  it('rejects asking about an item with no source text', async () => {
    const { service, prisma, ai } = makeService()
    prisma.concept.findFirst.mockResolvedValue({ id: 'c1', sourceText: '   ' })
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
    prisma.concept.findFirst.mockResolvedValue(INBOX)
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
