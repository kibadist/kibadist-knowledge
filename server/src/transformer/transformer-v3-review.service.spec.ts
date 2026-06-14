import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { AiService } from '../ai/ai.service'
import type { ArticlePipelineService } from './article-pipeline.service'
import type { PipelineService } from './pipeline.service'
import type { LearningLayer } from './schemas'
import { TransformerService } from './transformer.service'

/**
 * DET-359 v3-reader review overlay at the service boundary. These mutations are
 * keyed by the Article JSON v3 item id (keyConcepts / retrievalPrompts) and write
 * an id-agnostic overlay onto the learning layer. We pin the two acceptance
 * invariants here:
 *  - accepting a concept is a status flip ONLY — it never creates a Concept row,
 *    so it can't internalize knowledge,
 *  - a retrieval prompt can't be marked `answered` without an answer, and there
 *    is no path to a permanent "scheduled" state at all.
 */

function makeHarness(learningLayer: LearningLayer | null) {
  const article: Record<string, unknown> = {
    id: 'a1',
    sourceId: 'src1',
    workspaceId: 'w1',
    blocksVersion: 1,
    articleJson: { schemaVersion: 'v3' },
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

const emptyLayer = (): LearningLayer => ({
  concepts: [],
  retrievalPrompts: [],
})

describe('TransformerService.setV3ConceptReview (DET-359)', () => {
  it('accepts a concept as a status flip ONLY — never creating a Concept row', async () => {
    const { service, prisma } = makeHarness(emptyLayer())
    const layer = await service.setV3ConceptReview('u1', 'a1', 'kc1', {
      status: 'accepted',
    })
    expect(layer.v3Review?.concepts?.kc1?.status).toBe('accepted')
    // The acceptance invariant: accepting never internalizes knowledge.
    expect(prisma.concept.create).not.toHaveBeenCalled()
  })

  it('records a reject decision for an arbitrary v3 item id (id-agnostic)', async () => {
    const { service } = makeHarness(null)
    const layer = await service.setV3ConceptReview('u1', 'a1', 'kc-new', {
      status: 'rejected',
    })
    expect(layer.v3Review?.concepts?.['kc-new']?.status).toBe('rejected')
  })

  it('persists an in-place edit (label/definition/importance)', async () => {
    const { service } = makeHarness(emptyLayer())
    const layer = await service.setV3ConceptReview('u1', 'a1', 'kc1', {
      label: 'Tightened',
      definition: 'Clearer definition',
      importance: 'high',
    })
    const review = layer.v3Review?.concepts?.kc1
    expect(review?.label).toBe('Tightened')
    expect(review?.definition).toBe('Clearer definition')
    expect(review?.importance).toBe('high')
    // An edit without a status flip leaves the item undecided.
    expect(review?.status).toBe('pending')
  })

  it('merges successive decisions on the same id', async () => {
    const { service } = makeHarness(emptyLayer())
    await service.setV3ConceptReview('u1', 'a1', 'kc1', { label: 'Edited' })
    const layer = await service.setV3ConceptReview('u1', 'a1', 'kc1', {
      status: 'accepted',
    })
    expect(layer.v3Review?.concepts?.kc1?.label).toBe('Edited')
    expect(layer.v3Review?.concepts?.kc1?.status).toBe('accepted')
  })

  it('rejects an empty patch', async () => {
    const { service } = makeHarness(emptyLayer())
    await expect(
      service.setV3ConceptReview('u1', 'a1', 'kc1', {}),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('404s a foreign / unknown article', async () => {
    const { service } = makeHarness(emptyLayer())
    await expect(
      service.setV3ConceptReview('u1', 'nope', 'kc1', { status: 'accepted' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('TransformerService.setV3PromptReview (DET-359)', () => {
  it('persists a saved status without scheduling anything', async () => {
    const { service } = makeHarness(emptyLayer())
    const layer = await service.setV3PromptReview('u1', 'a1', 'rp1', {
      status: 'saved',
    })
    expect(layer.v3Review?.prompts?.rp1?.status).toBe('saved')
  })

  it('persists a user-authored answer with the answered status (the gate)', async () => {
    const { service } = makeHarness(emptyLayer())
    const layer = await service.setV3PromptReview('u1', 'a1', 'rp1', {
      status: 'answered',
      userAnswer: 'in my own words',
    })
    expect(layer.v3Review?.prompts?.rp1?.status).toBe('answered')
    expect(layer.v3Review?.prompts?.rp1?.userAnswer).toBe('in my own words')
  })

  it('refuses to mark answered without an answer', async () => {
    const { service } = makeHarness(emptyLayer())
    await expect(
      service.setV3PromptReview('u1', 'a1', 'rp1', { status: 'answered' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('honours a previously-stored answer when flipping to answered', async () => {
    const { service } = makeHarness(emptyLayer())
    await service.setV3PromptReview('u1', 'a1', 'rp1', {
      userAnswer: 'stored earlier',
    })
    const layer = await service.setV3PromptReview('u1', 'a1', 'rp1', {
      status: 'answered',
    })
    expect(layer.v3Review?.prompts?.rp1?.status).toBe('answered')
  })

  it('edits the prompt text in place', async () => {
    const { service } = makeHarness(emptyLayer())
    const layer = await service.setV3PromptReview('u1', 'a1', 'rp1', {
      prompt: 'Revised question?',
    })
    expect(layer.v3Review?.prompts?.rp1?.prompt).toBe('Revised question?')
  })

  it('rejects a blank prompt edit', async () => {
    const { service } = makeHarness(emptyLayer())
    await expect(
      service.setV3PromptReview('u1', 'a1', 'rp1', { prompt: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects an empty patch', async () => {
    const { service } = makeHarness(emptyLayer())
    await expect(
      service.setV3PromptReview('u1', 'a1', 'rp1', {}),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
