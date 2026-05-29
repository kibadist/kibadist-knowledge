import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { AI_PROVIDER, type AiProvider } from './ai-provider.interface'
import { OpenAiProvider } from './providers/openai.provider'

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AiProvider => {
        const provider = (
          config.get<string>('AI_PROVIDER') ?? 'openai'
        ).toLowerCase()
        switch (provider) {
          case 'openai':
            return new OpenAiProvider({
              apiKey: config.get<string>('OPENAI_API_KEY'),
              chatModel:
                config.get<string>('OPENAI_CHAT_MODEL') ?? 'gpt-4o-mini',
              embedModel:
                config.get<string>('OPENAI_EMBED_MODEL') ??
                'text-embedding-3-small',
            })
          case 'ollama':
            // Seam: drop in an `OllamaProvider implements AiProvider` and return it here.
            throw new Error(
              'AI_PROVIDER "ollama" is not implemented yet — add OllamaProvider to enable it',
            )
          default:
            throw new Error(
              `Unknown AI_PROVIDER "${provider}" (expected "openai" or "ollama")`,
            )
        }
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
