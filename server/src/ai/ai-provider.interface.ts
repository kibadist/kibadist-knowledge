export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionRequest {
  /** Single-prompt convenience input; ignored when `messages` is provided. */
  prompt?: string
  /** Full multi-turn message list; takes precedence over `prompt`. */
  messages?: ChatMessage[]
  /** Optional system instruction prepended to the conversation. */
  system?: string
  maxTokens?: number
  temperature?: number
  /**
   * Constrain the model to emit a single syntactically-valid JSON object
   * (OpenAI "JSON mode"). The prompt must mention JSON (the provider requires it,
   * and all our JSON prompts already do). Guarantees PARSEABILITY, not schema
   * validity — callers still validate. Prevents the malformed-JSON FAILEDs that
   * unescaped quotes / control chars in long text values would otherwise cause.
   */
  json?: boolean
}

export interface CompletionResult {
  text: string
  model: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface EmbeddingRequest {
  input: string | string[]
}

export interface EmbeddingResult {
  /** One vector per input, in input order. */
  embeddings: number[][]
  model: string
  dimensions: number
}

export interface ImageRequest {
  prompt: string
  /** Square or rectangular; provider maps it to output dimensions. */
  size?: '1024x1024' | '1536x1024' | '1024x1536'
}

export interface ImageResult {
  /** Raw PNG bytes, base64-encoded (no data: prefix). */
  base64: string
  mediaType: string
  width: number
  height: number
  model: string
}

/**
 * Vendor-neutral AI surface. Business logic depends on this (via AiService),
 * never on a provider SDK, so swapping providers is a DI/config change.
 */
export interface AiProvider {
  readonly name: string
  complete(request: CompletionRequest): Promise<CompletionResult>
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>
  image(request: ImageRequest): Promise<ImageResult>
}

/** DI token for the configured AiProvider implementation. */
export const AI_PROVIDER = Symbol('AI_PROVIDER')
