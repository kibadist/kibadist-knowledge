import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'

async function bootstrap() {
  const adapter = new FastifyAdapter({
    bodyLimit: 1048576, // 1MB
    forceCloseConnections: true,
  })

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: true },
  )

  // Use pino as the application logger.
  app.useLogger(app.get(Logger))

  // Allowed origins come from env so localhost is not baked into production.
  // CORS_ORIGINS (comma-separated) overrides FRONTEND_URL when set.
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
  const allowedOrigins = (process.env.CORS_ORIGINS || frontendUrl)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  })

  const fastify = app.getHttpAdapter().getInstance()

  // Liveness probe (no dependencies), exposed without the global prefix.
  fastify.get('/healthz', async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.send({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }),
  )

  app.setGlobalPrefix('api')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  app.enableShutdownHooks()

  const port = Number(process.env.PORT || 4000)
  await app.listen(port, '0.0.0.0')
}

void bootstrap()
