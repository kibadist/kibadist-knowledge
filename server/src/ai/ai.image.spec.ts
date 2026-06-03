import { AiService } from './ai.service'
import type { AiProvider, ImageResult } from './ai-provider.interface'
import { OpenAiProvider } from './providers/openai.provider'

describe('AiService.image', () => {
  it('delegates to the configured provider', async () => {
    const result: ImageResult = {
      base64: 'YWJj',
      mediaType: 'image/png',
      width: 1024,
      height: 1024,
      model: 'gpt-image-1',
    }
    const image = jest.fn(async () => result)
    const provider = { name: 'stub', image } as unknown as AiProvider
    const service = new AiService(provider)

    await expect(service.image({ prompt: 'hi' })).resolves.toBe(result)
    expect(image).toHaveBeenCalledWith({ prompt: 'hi' })
  })
})

describe('OpenAiProvider.image', () => {
  it('maps requested size to width/height and b64_json to base64', async () => {
    const provider = new OpenAiProvider({
      apiKey: 'sk-test',
      chatModel: 'gpt-4o-mini',
      embedModel: 'text-embedding-3-small',
      imageModel: 'gpt-image-1',
    })
    const generate = jest.fn(async () => ({
      data: [{ b64_json: 'QUJD' }],
    }))
    // Inject a mock OpenAI client (constructor builds a real one from the key).
    ;(provider as unknown as { client: unknown }).client = {
      images: { generate },
    }

    const result = await provider.image({ prompt: 'a cat', size: '1536x1024' })
    expect(generate).toHaveBeenCalledWith({
      model: 'gpt-image-1',
      prompt: 'a cat',
      size: '1536x1024',
      n: 1,
    })
    expect(result).toEqual({
      base64: 'QUJD',
      mediaType: 'image/png',
      width: 1536,
      height: 1024,
      model: 'gpt-image-1',
    })
  })

  it('defaults to 1024x1024 when no size is given', async () => {
    const provider = new OpenAiProvider({
      apiKey: 'sk-test',
      chatModel: 'gpt-4o-mini',
      embedModel: 'text-embedding-3-small',
      imageModel: 'gpt-image-1',
    })
    const generate = jest.fn(async () => ({ data: [{ b64_json: 'QUJD' }] }))
    ;(provider as unknown as { client: unknown }).client = {
      images: { generate },
    }

    const result = await provider.image({ prompt: 'a dog' })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1024x1024' }),
    )
    expect(result.width).toBe(1024)
    expect(result.height).toBe(1024)
  })
})
