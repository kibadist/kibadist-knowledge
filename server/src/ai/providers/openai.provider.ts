import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
import OpenAI from 'openai'

import type {
  AiProvider,
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  EmbeddingRequest,
  EmbeddingResult,
  ImageRequest,
  ImageResult,
} from '../ai-provider.interface'

export interface OpenAiProviderConfig {
  apiKey?: string
  chatModel: string
  embedModel: string
  imageModel: string
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai'
  private readonly client: OpenAI | null
  private readonly chatModel: string
  private readonly embedModel: string
  private readonly imageModel: string

  constructor(config: OpenAiProviderConfig) {
    this.chatModel = config.chatModel
    this.embedModel = config.embedModel
    this.imageModel = config.imageModel
    // Constructed without a key so the app still boots; calls fail clearly.
    this.client = config.apiKey ? new OpenAI({ apiKey: config.apiKey }) : null
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const client = this.requireClient()
    try {
      const response = await client.chat.completions.create({
        model: this.chatModel,
        messages: this.toMessages(request),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        // JSON mode (gpt-4o-mini default supports it): forces a parseable JSON
        // object so a stray unescaped quote in a long value can't sink the call.
        ...(request.json
          ? { response_format: { type: 'json_object' as const } }
          : {}),
      })
      const choice = response.choices[0]
      return {
        text: choice?.message?.content ?? '',
        model: response.model,
        usage: {
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
        },
      }
    } catch (error) {
      throw this.translateError(error)
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const client = this.requireClient()
    try {
      const response = await client.embeddings.create({
        model: this.embedModel,
        input: request.input,
      })
      const embeddings = response.data.map((item) => item.embedding)
      return {
        embeddings,
        model: response.model,
        dimensions: embeddings[0]?.length ?? 0,
      }
    } catch (error) {
      throw this.translateError(error)
    }
  }

  async image(request: ImageRequest): Promise<ImageResult> {
    const client = this.requireClient()
    const size = request.size ?? '1024x1024'
    const [width, height] = size.split('x').map(Number)
    try {
      const response = await client.images.generate({
        model: this.imageModel,
        prompt: request.prompt,
        size,
        n: 1,
      })
      const base64 = response.data?.[0]?.b64_json
      if (!base64) {
        throw new BadGatewayException('OpenAI returned no image data')
      }
      return {
        base64,
        mediaType: 'image/png',
        width,
        height,
        model: this.imageModel,
      }
    } catch (error) {
      throw this.translateError(error)
    }
  }

  private requireClient(): OpenAI {
    if (!this.client) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured')
    }
    return this.client
  }

  /**
   * Maps OpenAI SDK errors to meaningful HTTP errors so upstream failures
   * don't surface as opaque 500s. Strips any API key from the message.
   */
  private translateError(error: unknown): Error {
    if (error instanceof OpenAI.APIError) {
      const status = error.status ?? 502
      const message = (error.message ?? 'OpenAI request failed').replace(
        /sk-[A-Za-z0-9_-]+/g,
        'sk-***',
      )
      if (status === 429) {
        return new ServiceUnavailableException(
          `OpenAI rate limit or quota exceeded: ${message}`,
        )
      }
      // 4xx (e.g. a gpt-image-1 content-policy refusal) is a rejected request,
      // not a server fault — surface it as a 4xx so the UI can say "the prompt
      // was rejected" rather than implying an upstream outage.
      if (status >= 400 && status < 500) {
        return new BadRequestException(
          `OpenAI rejected the request (${status}): ${message}`,
        )
      }
      return new BadGatewayException(
        `OpenAI request failed (${status}): ${message}`,
      )
    }
    return error instanceof Error ? error : new Error(String(error))
  }

  private toMessages(
    request: CompletionRequest,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const messages: ChatMessage[] = []
    if (request.system)
      messages.push({ role: 'system', content: request.system })
    if (request.messages?.length) {
      messages.push(...request.messages)
    } else if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt })
    }
    return messages
  }
}
