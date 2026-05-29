import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'

import { ArticulationsModule } from './articulations/articulations.module'
import { AuthModule } from './auth/auth.module'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard'
import { ConceptsModule } from './concepts/concepts.module'
import { LinksModule } from './links/links.module'
import { NotesModule } from './notes/notes.module'
import { PrismaModule } from './prisma/prisma.module'
import { RetrievalModule } from './retrieval/retrieval.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
      },
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    NotesModule,
    ConceptsModule,
    ArticulationsModule,
    LinksModule,
    RetrievalModule,
  ],
  providers: [
    // Global authentication: every route requires a valid JWT unless marked @Public().
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
