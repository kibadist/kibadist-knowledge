import type { ZodType } from 'zod'

import type { AiService } from '../ai/ai.service'

/**
 * Shared LLM-JSON helper for the transformer pipeline (spec §Existing assets).
 *
 * `AiService.complete` returns RAW text only — no JSON parsing, no schema, no
 * retry. Every transformer LLM call goes through this helper instead of copying
 * a per-prompt `stripFence`/`parseJsonObject` (the divergence from the
 * hand-written-parser house style is intentional: the spec requires schema
 * validation, so we use zod).
 *
 * Behavior (deliberately strict / loud):
 *   - temperature 0 (deterministic — the call sites never override this).
 *   - strip ``` / ```json code fences, then `JSON.parse`, then zod-validate.
 *   - on ANY failure (non-JSON, parse error, schema mismatch) retry ONCE,
 *     appending the failure detail to the prompt so the model can self-correct.
 *   - on a SECOND failure, throw a descriptive Error (loud failure, per DET-251
 *     "fail loudly"); callers translate that into the pipeline's FAILED status.
 */
export async function completeJson<T>(
  ai: AiService,
  opts: {
    system: string
    prompt: string
    schema: ZodType<T>
    maxTokens?: number
  },
): Promise<T> {
  const { system, schema, maxTokens } = opts
  let prompt = opts.prompt
  let lastError = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await ai.complete({
      system,
      prompt,
      temperature: 0,
      maxTokens,
    })

    const result = tryParse(text, schema)
    if (result.ok) return result.value

    lastError = result.error
    if (attempt === 0) {
      // Feed the exact failure back so the retry can self-correct. The model's
      // previous (broken) output is NOT trusted as instructions — we only quote
      // the structural error and re-ask for valid JSON.
      prompt = `${opts.prompt}

Your previous response was rejected: ${result.error}
Return ONLY valid JSON that satisfies the required schema. No prose, no code fences.`
    }
  }

  throw new Error(
    `LLM JSON output failed validation after one retry: ${lastError}`,
  )
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

function tryParse<T>(raw: string, schema: ZodType<T>): ParseResult<T> {
  const stripped = stripFence(raw)
  if (!stripped) return { ok: false, error: 'empty response' }

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (error) {
    return {
      ok: false,
      error: `not valid JSON (${
        error instanceof Error ? error.message : String(error)
      })`,
    }
  }

  const validated = schema.safeParse(parsed)
  if (!validated.success) {
    return { ok: false, error: formatZodError(validated.error) }
  }
  return { ok: true, value: validated.data }
}

/**
 * Strip a Markdown code fence if the model wrapped its JSON in one. Tolerant of
 * an optional language tag (```json) and surrounding whitespace; when there's
 * no fence the input is returned trimmed.
 */
export function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fenced) return fenced[1].trim()
  return trimmed
}

/** Compact, human-readable summary of a zod error for the retry prompt + throw. */
function formatZodError(error: {
  issues: { path: PropertyKey[]; message: string }[]
}): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}
