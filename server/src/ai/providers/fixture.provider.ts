import { Logger } from '@nestjs/common'

import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
  EmbeddingRequest,
  EmbeddingResult,
  ImageRequest,
  ImageResult,
} from '../ai-provider.interface'
import { synthesizeCompletion } from './fixture-content.util'

/**
 * Deterministic, network-free AI provider (DET-343). It returns SOURCE-GROUNDED
 * fixture responses derived from the actual prompt, so the entire transformer
 * pipeline — block classification AND the v3 source-grounded learning engine —
 * runs end-to-end with NO `OPENAI_API_KEY` and NO network.
 *
 * This is the keyless verification + offline-demo seam the architecture already
 * anticipates ("swapping providers is a DI/config change"). It is selected by
 * `AI_PROVIDER=fixture`, and `AiModule` also auto-falls back to it when the
 * configured OpenAI provider has no key (so a keyless environment is functional
 * rather than inert). The downstream grounding/coverage/quality machinery is the
 * real thing; only the model call is replaced. See `fixture-content.util.ts`.
 *
 * It is NOT a substitute for the model in production: the text it emits is a
 * faithful restatement of the source blocks (real ids, real claims), never new
 * knowledge — which is exactly what makes it safe and deterministic for tests
 * and verification.
 */
export class FixtureAiProvider implements AiProvider {
  readonly name = 'fixture'
  private readonly logger = new Logger(FixtureAiProvider.name)

  /** Dimensions of the deterministic embedding vectors (matches OpenAI small). */
  private readonly embedDimensions = 1536

  // A 1x1 transparent PNG, base64 (no data: prefix) — a valid, tiny image so the
  // illustration path can complete without a model.
  private static readonly ONE_PX_PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  complete(request: CompletionRequest): Promise<CompletionResult> {
    const prompt = request.prompt ?? this.lastUserMessage(request)
    const text = synthesizeCompletion(request.system, prompt)
    return Promise.resolve({
      text,
      model: this.name,
      usage: { inputTokens: 0, outputTokens: 0 },
    })
  }

  embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const inputs = Array.isArray(request.input)
      ? request.input
      : [request.input]
    const embeddings = inputs.map((text) => this.deterministicVector(text))
    return Promise.resolve({
      embeddings,
      model: this.name,
      dimensions: this.embedDimensions,
    })
  }

  image(request: ImageRequest): Promise<ImageResult> {
    const size = request.size ?? '1024x1024'
    const [width, height] = size.split('x').map(Number)
    return Promise.resolve({
      base64: FixtureAiProvider.ONE_PX_PNG,
      mediaType: 'image/png',
      width,
      height,
      model: this.name,
    })
  }

  /** Pull the user turn out of a messages-style request. */
  private lastUserMessage(request: CompletionRequest): string {
    const user = request.messages?.filter((m) => m.role === 'user').pop()
    return user?.content ?? ''
  }

  /**
   * A stable, content-derived unit-ish vector. Not semantically meaningful — it
   * exists only so any embedding call (e.g. concept promotion) succeeds offline.
   */
  private deterministicVector(text: string): number[] {
    const vec = new Array<number>(this.embedDimensions)
    let h = 2166136261
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    for (let i = 0; i < this.embedDimensions; i++) {
      // xorshift the running hash to fill the vector deterministically.
      h ^= h << 13
      h ^= h >>> 17
      h ^= h << 5
      vec[i] = ((h >>> 0) % 2000) / 1000 - 1 // ~[-1, 1)
    }
    return vec
  }
}
