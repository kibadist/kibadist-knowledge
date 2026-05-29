import { Body, Controller, Post } from '@nestjs/common'

import { AiService } from './ai.service'
import { CompleteDto } from './dto/complete.dto'
import { EmbedDto } from './dto/embed.dto'

// Protected by the global JwtAuthGuard. Thin diagnostic surface that exercises
// the provider abstraction; cognitive/interrogation logic lands in later tickets.
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('complete')
  async complete(@Body() dto: CompleteDto) {
    const result = await this.aiService.complete({
      prompt: dto.prompt,
      system: dto.system,
      maxTokens: dto.maxTokens,
      temperature: dto.temperature,
    })
    return { provider: this.aiService.providerName, ...result }
  }

  @Post('embed')
  async embed(@Body() dto: EmbedDto) {
    const result = await this.aiService.embed({ input: dto.input })
    // Vectors can be large; return shape + a small sample, not the full vector.
    return {
      provider: this.aiService.providerName,
      model: result.model,
      dimensions: result.dimensions,
      count: result.embeddings.length,
      sample: result.embeddings[0]?.slice(0, 8) ?? [],
    }
  }
}
