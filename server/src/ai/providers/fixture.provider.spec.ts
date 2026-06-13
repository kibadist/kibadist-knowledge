import { buildRewritePrompt } from '../../transformer/v3/v3-generator.prompt'
import { FixtureAiProvider } from './fixture.provider'

describe('FixtureAiProvider', () => {
  const provider = new FixtureAiProvider()

  it('is named "fixture"', () => {
    expect(provider.name).toBe('fixture')
  })

  it('completes a v3 rewrite into parseable, grounded JSON', async () => {
    const { system, prompt } = buildRewritePrompt(
      [
        {
          id: 'b1',
          blockType: 'paragraph',
          classification: 'MAIN_ARGUMENT',
          text: 'Retrieval practice strengthens memory more than re-reading.',
        },
      ],
      'structured_article',
    )
    const result = await provider.complete({ system, prompt, json: true })
    expect(result.model).toBe('fixture')
    const parsed = JSON.parse(result.text)
    expect(parsed.title).toBeTruthy()
    expect(JSON.stringify(parsed)).toContain('b1')
  })

  it('reads the prompt from a messages-style request', async () => {
    const { system, prompt } = buildRewritePrompt(
      [
        {
          id: 'bx',
          blockType: 'paragraph',
          classification: 'DEFINITION',
          text: 'A schema is a structured mental model.',
        },
      ],
      'reference',
    )
    const result = await provider.complete({
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    expect(JSON.stringify(JSON.parse(result.text))).toContain('bx')
  })

  it('returns deterministic 1536-d embeddings', async () => {
    const a = await provider.embed({ input: 'hello world' })
    const b = await provider.embed({ input: 'hello world' })
    expect(a.dimensions).toBe(1536)
    expect(a.embeddings[0]).toHaveLength(1536)
    expect(a.embeddings[0]).toEqual(b.embeddings[0])
    const c = await provider.embed({ input: 'different text' })
    expect(c.embeddings[0]).not.toEqual(a.embeddings[0])
  })

  it('returns a valid tiny PNG for images', async () => {
    const img = await provider.image({ prompt: 'anything', size: '1024x1024' })
    expect(img.mediaType).toBe('image/png')
    expect(img.width).toBe(1024)
    expect(Buffer.from(img.base64, 'base64').subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  })
})
