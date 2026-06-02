import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { LoggerModule } from 'nestjs-pino'
import { stdSerializers } from 'pino'

import { AiModule } from './ai/ai.module'
import { ArticulationsModule } from './articulations/articulations.module'
import { AuthModule } from './auth/auth.module'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'
import { ConceptLibraryModule } from './concept-library/concept-library.module'
import { ConceptStateModule } from './concept-state/concept-state.module'
import { ConceptsModule } from './concepts/concepts.module'
import { ConnectorModule } from './connector/connector.module'
import { DecayModule } from './decay/decay.module'
import { DomainsModule } from './domains/domains.module'
import { GraphModule } from './graph/graph.module'
import { InboxModule } from './inbox/inbox.module'
import { IntakeModule } from './intake/intake.module'
import { LinksModule } from './links/links.module'
import { LivingConceptModule } from './living-concept/living-concept.module'
import { MetricsModule } from './metrics/metrics.module'
import { NotesModule } from './notes/notes.module'
import { PrismaModule } from './prisma/prisma.module'
import { PromotionModule } from './promotion/promotion.module'
import { ReflectionModule } from './reflection/reflection.module'
import { RetrievalModule } from './retrieval/retrieval.module'
import { SearchModule } from './search/search.module'
import { SessionsModule } from './sessions/sessions.module'
import { SourceQaModule } from './source-qa/source-qa.module'
import { UserThrottlerGuard } from './throttler/user-throttler.guard'
import { TutorModule } from './tutor/tutor.module'
import { UsersModule } from './users/users.module'
import { WorkspacesModule } from './workspaces/workspaces.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Per-user rate limiting (DET-207). Trackers are keyed on the authenticated
    // user id (see UserThrottlerGuard), not IP. Two named throttlers:
    //   - default: lenient ceiling for ordinary CRUD/reads (120 req/user/min).
    //   - ai:      strict ceiling for paid OpenAI-backed endpoints. 20/user/min
    //              is generous for a human in the loop but ruinous for an abuse
    //              script — a runaway loop is capped at 20 paid calls/minute.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'ai', ttl: 60_000, limit: 20 },
    ]),
    LoggerModule.forRoot({
      pinoHttp: {
        ...(process.env.NODE_ENV !== 'production'
          ? {
              transport: {
                target: 'pino-pretty',
                options: { colorize: true, singleLine: true },
              },
              level: 'debug',
            }
          : { level: 'info' }),
        autoLogging: true,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
          ],
          censor: '[REDACTED]',
        },
        serializers: {
          // Defense-in-depth: strip any API key that slips into a logged
          // error message/stack (e.g. an upstream SDK error we didn't translate).
          err: (error: Error) => {
            const serialized = stdSerializers.err(error)
            const scrub = (value: string) =>
              value.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
            if (serialized.message)
              serialized.message = scrub(serialized.message)
            if (serialized.stack) serialized.stack = scrub(serialized.stack)
            return serialized
          },
        },
      },
    }),
    PrismaModule,
    WorkspacesModule,
    AuthModule,
    UsersModule,
    NotesModule,
    ConceptStateModule,
    ConceptsModule,
    ConceptLibraryModule,
    ConnectorModule,
    DecayModule,
    DomainsModule,
    GraphModule,
    InboxModule,
    IntakeModule,
    LivingConceptModule,
    PromotionModule,
    SourceQaModule,
    ArticulationsModule,
    LinksModule,
    RetrievalModule,
    ReflectionModule,
    TutorModule,
    AiModule,
    SearchModule,
    SessionsModule,
    MetricsModule,
  ],
  providers: [
    // Global authentication: every route requires a valid JWT unless marked @Public().
    // MUST be registered before the throttler guard: APP_GUARD providers run in
    // registration order, and the throttler reads req.user (set here) to key the
    // rate limit per user.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global rate limiting (DET-207). Runs after JwtAuthGuard so req.user exists.
    // Routes get the lenient `default` limit unless they opt into a stricter
    // named throttler via @Throttle (paid AI endpoints use { ai: ... }).
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class AppModule {}
