import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { AiService } from '../ai/ai.service'
import type { ArticlePipelineService } from './article-pipeline.service'
import type { PipelineService } from './pipeline.service'
import type { LearningLayer } from './schemas'
import { TransformerService } from './transformer.service'

/**
 * DET-359 review-layer mutations at the service boundary. We verify content-only
 * editing (never a validation-status change, never a Concept row), retrieval
 * prompt review persistence, and the two invariants the acceptance criteria pin:
 *  - editing can't internalize knowledge (no `concept.create`),
 *  - a retrieval prompt can't be marked `answered` without an answer, and the
 *    endpoint has no path to a permanent "scheduled" state at all.
 */

function makeHarness(learningLayer: LearningLayer | null) {
  const article: Record<string, unknown> = {
    id: 'a1',
    sourceId: 'src1',
    workspaceId: 'w1',
    blocksVersion: 1,
    articleJson: { schemaVersion: 'v2' },
    learningLayer,
  }

  const prisma = {
    $transaction: (arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    $queryRaw: jest.fn(async () => []),
    transformedArticle: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'a1' ? { ...article } : null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'a1' ? { learningLayer: article.learningLayer } : null,
      ),
      update: jest.fn(
        async ({ data }: { data: { learningLayer: unknown } }) => {
          article.learningLayer = data.learningLayer
          return { ...article }
        },
      ),
    },
    concept: {
      create: jest.fn(async () => ({ id: 'con-1' })),
    },
  }

  const service = new TransformerService(
    prisma as never,
    {} as PipelineService,
    {} as ArticlePipelineService,
    {} as AiService,
    { recordCapture: jest.fn() } as never,
  )
  return { service, prisma, article }
}

const baseLayer = (): LearningLayer => ({
  concepts: [
    {
      id: 'k1',
      label: 'Study concept',
      definition: 'old def',
      sourceBlockIds: ['b1'],
      validationStatus: 'pending',
    },
  ],
  retrievalPrompts: [
    { id: 'p1', prompt: 'What is X?', sourceBlockIds: ['b1'] },
  ],
  conceptCandidates: [
    {
      id: 'cc1',
      sectionId: 's1',
      label: 'Candidate',
      definition: 'old def',
      sourceBlockIds: ['b1'],
      aiAssisted: true,
      validationStatus: 'pending',
    },
  ],
})

describe('TransformerService.editLearningItem (DET-359)', () => {
  it('edits a candidate label/definition/importance without changing status', async () => {
    const { service, prisma } = makeHarness(baseLayer())
    const layer = await service.editLearningItem('u1', 'a1', 'cc1', {
      label: 'New label',
      definition: 'New def',
      importance: 'high',
    })
    const cc = layer.conceptCandidates?.[0]
    expect(cc?.label).toBe('New label')
    expect(cc?.definition).toBe('New def')
    expect(cc?.importance).toBe('high')
    expect(cc?.validationStatus).toBe('pending')
    // Editing is content-only: it never creates a knowledge row.
    expect(prisma.concept.create).not.toHaveBeenCalled()
  })

  it('edits a study concept and leaves only the provided fields', async () => {
    const { service } = makeHarness(baseLayer())
    const layer = await service.editLearningItem('u1', 'a1', 'k1', {
      definition: 'tightened def',
    })
    expect(layer.concepts[0].definition).toBe('tightened def')
    expect(layer.concepts[0].label).toBe('Study concept')
  })

  it('rejects an empty edit', async () => {
    const { service } = makeHarness(baseLayer())
    await expect(
      service.editLearningItem('u1', 'a1', 'cc1', {}),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('404s an unknown item', async () => {
    const { service } = makeHarness(baseLayer())
    await expect(
      service.editLearningItem('u1', 'a1', 'nope', { label: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('TransformerService.updateRetrievalPromptReview (DET-359)', () => {
  it('persists a saved status', async () => {
    const { service } = makeHarness(baseLayer())
    const layer = await service.updateRetrievalPromptReview('u1', 'a1', 'p1', {
      reviewStatus: 'saved',
    })
    expect(layer.retrievalPrompts[0].reviewStatus).toBe('saved')
  })

  it('persists an answer with the answered status (the scheduling gate)', async () => {
    const { service } = makeHarness(baseLayer())
    const layer = await service.updateRetrievalPromptReview('u1', 'a1', 'p1', {
      reviewStatus: 'answered',
      userAnswer: 'my own words',
    })
    expect(layer.retrievalPrompts[0].reviewStatus).toBe('answered')
    expect(layer.retrievalPrompts[0].userAnswer).toBe('my own words')
  })

  it('refuses to mark answered without an answer', async () => {
    const { service } = makeHarness(baseLayer())
    await expect(
      service.updateRetrievalPromptReview('u1', 'a1', 'p1', {
        reviewStatus: 'answered',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('edits the prompt text in place', async () => {
    const { service } = makeHarness(baseLayer())
    const layer = await service.updateRetrievalPromptReview('u1', 'a1', 'p1', {
      prompt: 'Revised?',
    })
    expect(layer.retrievalPrompts[0].prompt).toBe('Revised?')
  })

  it('rejects a blank prompt edit', async () => {
    const { service } = makeHarness(baseLayer())
    await expect(
      service.updateRetrievalPromptReview('u1', 'a1', 'p1', { prompt: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('404s an unknown prompt', async () => {
    const { service } = makeHarness(baseLayer())
    await expect(
      service.updateRetrievalPromptReview('u1', 'a1', 'nope', {
        reviewStatus: 'saved',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
