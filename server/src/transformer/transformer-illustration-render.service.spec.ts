import { ConflictException, NotFoundException } from '@nestjs/common'
import type { AiService } from '../ai/ai.service'
import type { ImageRequest, ImageResult } from '../ai/ai-provider.interface'
import type { ArticlePipelineService } from './article-pipeline.service'
import type { PipelineService } from './pipeline.service'
import type { IllustrationPlan, IllustrationSuggestion } from './schemas'
import { TransformerService } from './transformer.service'

/**
 * DET-261 render/serve/delete guards. The image is generated ONLY after approval
 * and ONLY from the approved suggestion's own text — never the source blocks —
 * all enforced in CODE, not the client. Specs mock AiService.image + Prisma.
 */

function suggestion(
  over: Partial<IllustrationSuggestion> = {},
): IllustrationSuggestion {
  return {
    id: 's1',
    illustrationType: 'editorial_cover',
    purpose: 'p',
    visualDescription: 'A lighthouse on a cliff',
    caption: 'Guiding light',
    fidelityRisk: 'low',
    reason: 'r',
    sourceBlockIds: ['b1'],
    approval: 'approved',
    ...over,
  }
}

/** A Prisma stub holding one owned article whose illustrationPlan we mutate. */
function makeHarness(suggestions: IllustrationSuggestion[]) {
  const article: Record<string, unknown> = {
    id: 'a1',
    sourceId: 'src1',
    blocksVersion: 1,
    illustrationPlan: { suggestions } as IllustrationPlan,
  }
  const images = new Map<string, Record<string, unknown>>()
  const key = (articleId: string, suggestionId: string) =>
    `${articleId}:${suggestionId}`

  const prisma = {
    // The service batches the image-row write + plan patch in $transaction([...]);
    // the mocked ops already run when the array is built, so just await them.
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    transformedArticle: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'a1' ? { ...article } : null,
      ),
      update: jest.fn(
        async ({ data }: { data: { illustrationPlan: unknown } }) => {
          article.illustrationPlan = data.illustrationPlan
          return { ...article }
        },
      ),
    },
    transformerIllustrationImage: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: {
            articleId_suggestionId: { articleId: string; suggestionId: string }
          }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          const { articleId, suggestionId } = where.articleId_suggestionId
          images.set(key(articleId, suggestionId), { ...create })
          return create
        },
      ),
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            articleId_suggestionId: { articleId: string; suggestionId: string }
          }
        }) => {
          const { articleId, suggestionId } = where.articleId_suggestionId
          return images.get(key(articleId, suggestionId)) ?? null
        },
      ),
      deleteMany: jest.fn(
        async ({
          where,
        }: {
          where: { articleId: string; suggestionId: string }
        }) => {
          images.delete(key(where.articleId, where.suggestionId))
          return { count: 1 }
        },
      ),
    },
  }

  const image = jest.fn(
    async (_req: ImageRequest): Promise<ImageResult> => ({
      base64: Buffer.from('PNGBYTES').toString('base64'),
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
      model: 'gpt-image-1',
    }),
  )
  const ai = { image, providerName: 'openai' } as unknown as AiService

  const service = new TransformerService(
    prisma as never,
    {} as PipelineService,
    {} as ArticlePipelineService,
    ai,
  )
  return { service, prisma, ai, image, article, images, key }
}

describe('TransformerService illustration render (DET-261)', () => {
  it('rejects a non-approved suggestion with 409', async () => {
    const { service, image } = makeHarness([
      suggestion({ approval: 'pending' }),
    ])
    await expect(
      service.renderIllustration('u1', 'a1', 's1', false),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(image).not.toHaveBeenCalled()
  })

  it('rejects a high-risk suggestion without confirmation (409)', async () => {
    const { service, image } = makeHarness([
      suggestion({ fidelityRisk: 'high' }),
    ])
    await expect(
      service.renderIllustration('u1', 'a1', 's1', false),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(image).not.toHaveBeenCalled()
  })

  it('renders a high-risk suggestion when confirmHighRisk is true', async () => {
    const { service, image } = makeHarness([
      suggestion({ fidelityRisk: 'high' }),
    ])
    const plan = await service.renderIllustration('u1', 'a1', 's1', true)
    expect(image).toHaveBeenCalledTimes(1)
    expect(plan.suggestions[0].image).toMatchObject({ model: 'gpt-image-1' })
  })

  it('renders an approved low-risk suggestion: prompt from suggestion text only, upserts, patches plan', async () => {
    const { service, image, prisma } = makeHarness([suggestion()])
    const plan = await service.renderIllustration('u1', 'a1', 's1', false)

    expect(image).toHaveBeenCalledTimes(1)
    const promptArg = image.mock.calls[0][0].prompt
    expect(promptArg).toContain('A lighthouse on a cliff') // visualDescription
    expect(promptArg).toContain('Caption: Guiding light') // caption
    // never reads source blocks — no block text leaks into the prompt
    expect(promptArg).not.toContain('b1')
    // generated at the landscape 3:2 size (presented 16:9 on the client)
    expect(image.mock.calls[0][0].size).toBe('1536x1024')

    expect(prisma.transformerIllustrationImage.upsert).toHaveBeenCalledTimes(1)
    expect(plan.suggestions[0].image).toEqual({
      width: 1024,
      height: 1024,
      provider: 'openai',
      model: 'gpt-image-1',
      generatedAt: expect.any(String),
    })
    expect(prisma.transformedArticle.update).toHaveBeenCalled()
  })

  it('404 when the suggestion is not in the plan', async () => {
    const { service } = makeHarness([suggestion()])
    await expect(
      service.renderIllustration('u1', 'a1', 'ghost', false),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('ownership scoping: a non-owned article 404s on render', async () => {
    const { service, prisma } = makeHarness([suggestion()])
    await expect(
      service.renderIllustration('u1', 'other', 's1', false),
    ).rejects.toBeInstanceOf(NotFoundException)
    // findFirst is always called with the source userId guard
    expect(prisma.transformedArticle.findFirst).toHaveBeenCalledWith({
      where: { id: 'other', source: { userId: 'u1' } },
    })
  })

  it('streams stored bytes after a render and 404s when absent', async () => {
    const { service } = makeHarness([suggestion()])
    await expect(
      service.getIllustrationImage('u1', 'a1', 's1'),
    ).rejects.toBeInstanceOf(NotFoundException)

    await service.renderIllustration('u1', 'a1', 's1', false)
    const img = await service.getIllustrationImage('u1', 'a1', 's1')
    expect(img.mediaType).toBe('image/png')
    expect(img.data.toString()).toBe('PNGBYTES')
  })

  it('delete removes the row and clears suggestion.image', async () => {
    const { service, images, key } = makeHarness([suggestion()])
    await service.renderIllustration('u1', 'a1', 's1', false)
    expect(images.has(key('a1', 's1'))).toBe(true)

    const plan = await service.deleteIllustrationImage('u1', 'a1', 's1')
    expect(images.has(key('a1', 's1'))).toBe(false)
    expect(plan.suggestions[0].image).toBeNull()
  })
})
