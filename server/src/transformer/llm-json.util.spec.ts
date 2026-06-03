import { z } from 'zod'

import type { AiService } from '../ai/ai.service'
import { completeJson, stripFence } from './llm-json.util'

const schema = z.object({ name: z.string(), age: z.number() })

/** A stub AiService whose `complete` returns the queued texts in order. */
function aiReturning(...texts: string[]): {
  ai: AiService
  complete: jest.Mock
} {
  const complete = jest.fn()
  for (const t of texts) {
    complete.mockResolvedValueOnce({ text: t, model: 'stub' })
  }
  return { ai: { complete } as unknown as AiService, complete }
}

describe('stripFence', () => {
  it('strips a ```json fence', () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('strips a bare ``` fence', () => {
    expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('returns trimmed input when there is no fence', () => {
    expect(stripFence('  {"a":1}  ')).toBe('{"a":1}')
  })
})

describe('completeJson', () => {
  it('happy path: parses and validates valid JSON', async () => {
    const { ai, complete } = aiReturning('{"name":"Ada","age":36}')
    const out = await completeJson(ai, {
      system: 'sys',
      prompt: 'p',
      schema,
    })
    expect(out).toEqual({ name: 'Ada', age: 36 })
    expect(complete).toHaveBeenCalledTimes(1)
    // Always temperature 0.
    expect(complete.mock.calls[0][0]).toMatchObject({ temperature: 0 })
  })

  it('strips code fences before parsing', async () => {
    const { ai } = aiReturning('```json\n{"name":"Ada","age":36}\n```')
    const out = await completeJson(ai, { system: 's', prompt: 'p', schema })
    expect(out).toEqual({ name: 'Ada', age: 36 })
  })

  it('retries once on invalid JSON, then succeeds', async () => {
    const { ai, complete } = aiReturning(
      'not json at all',
      '{"name":"Ada","age":36}',
    )
    const out = await completeJson(ai, { system: 's', prompt: 'p', schema })
    expect(out).toEqual({ name: 'Ada', age: 36 })
    expect(complete).toHaveBeenCalledTimes(2)
    // The retry prompt carries the previous failure detail for self-correction.
    expect(complete.mock.calls[1][0].prompt).toContain('was rejected')
  })

  it('retries once on schema violation, then succeeds', async () => {
    const { ai, complete } = aiReturning(
      '{"name":"Ada"}', // missing age
      '{"name":"Ada","age":36}',
    )
    const out = await completeJson(ai, { system: 's', prompt: 'p', schema })
    expect(out).toEqual({ name: 'Ada', age: 36 })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('throws a descriptive error after two failures', async () => {
    const { ai, complete } = aiReturning('garbage', 'still garbage')
    await expect(
      completeJson(ai, { system: 's', prompt: 'p', schema }),
    ).rejects.toThrow(/failed validation after one retry/)
    expect(complete).toHaveBeenCalledTimes(2)
  })
})
