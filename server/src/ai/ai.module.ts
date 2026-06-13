import { Logger, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { AI_PROVIDER, type AiProvider } from './ai-provider.interface'
import { FixtureAiProvider } from './providers/fixture.provider'
import { OpenAiProvider } from './providers/openai.provider'

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: AI_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AiProvider => {
        const logger = new Logger('AiModule')
        const provider = (
          config.get<string>('AI_PROVIDER') ?? 'openai'
        ).toLowerCase()
        switch (provider) {
          case 'fixture':
            // Deterministic, network-free provider (DET-343): keyless verification
            // and offline demos. Explicitly opted into.
            logger.warn(
              'AI_PROVIDER=fixture — using the deterministic offline provider; no real model calls will be made.',
            )
            return new FixtureAiProvider()
          case 'openai': {
            const apiKey = config.get<string>('OPENAI_API_KEY')
            // Auto-fallback (DET-343): with no key the OpenAI provider can only
            // fail every call, leaving the app inert (nothing generates, nothing
            // is observable). Fall back to the fixture provider so a keyless
            // environment — notably unattended browser verification — is fully
            // functional. Production always has a key, so this never engages there.
            if (!apiKey || apiKey.trim().length === 0) {
              logger.warn(
                'OPENAI_API_KEY is not set — falling back to the deterministic fixture AI provider (DET-343). Set AI_PROVIDER=openai with a key to use the real model.',
              )
              return new FixtureAiProvider()
            }
            return new OpenAiProvider({
              apiKey,
              chatModel:
                config.get<string>('OPENAI_CHAT_MODEL') ?? 'gpt-4o-mini',
              embedModel:
                config.get<string>('OPENAI_EMBED_MODEL') ??
                'text-embedding-3-small',
              imageModel:
                config.get<string>('OPENAI_IMAGE_MODEL') ?? 'gpt-image-1',
            })
          }
          case 'ollama':
            // Seam: drop in an `OllamaProvider implements AiProvider` and return it here.
            throw new Error(
              'AI_PROVIDER "ollama" is not implemented yet — add OllamaProvider to enable it',
            )
          default:
            throw new Error(
              `Unknown AI_PROVIDER "${provider}" (expected "openai", "fixture", or "ollama")`,
            )
        }
      },
    },
  ],
  exports: [AiService],
})
export class AiModule {}
