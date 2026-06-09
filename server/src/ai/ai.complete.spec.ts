import { OpenAiProvider } from './providers/openai.provider'

/** A provider with a mocked chat.completions client; returns the create spy. */
function makeProvider() {
  const provider = new OpenAiProvider({
    apiKey: 'sk-test',
    chatModel: 'gpt-4o-mini',
    embedModel: 'text-embedding-3-small',
    imageModel: 'gpt-image-1',
  })
  const create = jest.fn(async () => ({
    choices: [{ message: { content: '{"ok":true}' } }],
    model: 'gpt-4o-mini',
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  }))
  ;(provider as unknown as { client: unknown }).client = {
    chat: { completions: { create } },
  }
  return { provider, create }
}

describe('OpenAiProvider.complete', () => {
  it('requests JSON mode (response_format) when json is set', async () => {
    const { provider, create } = makeProvider()
    await provider.complete({ prompt: 'return JSON', json: true })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      }),
    )
  })

  it('omits response_format when json is not set', async () => {
    const { provider, create } = makeProvider()
    await provider.complete({ prompt: 'hi' })
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({ response_format: expect.anything() }),
    )
  })
})
