import { Inject, Injectable } from '@nestjs/common'

import {
  AI_PROVIDER,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type EmbeddingRequest,
  type EmbeddingResult,
} from './ai-provider.interface'

/**
 * Stable injectable the rest of the app uses for AI. Delegates to whichever
 * provider was wired by AiModule, so call sites never import a vendor SDK.
 */
@Injectable()
export class AiService {
  constructor(@Inject(AI_PROVIDER) private readonly provider: AiProvider) {}

  get providerName(): string {
    return this.provider.name
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    return this.provider.complete(request)
  }

  embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    return this.provider.embed(request)
  }
}
