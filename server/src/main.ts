import 'reflect-metadata'
import multipart from '@fastify/multipart'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { MAX_PDF_BYTES } from './inbox/inbox.constants'

async function bootstrap() {
  const adapter = new FastifyAdapter({
    // 1MB JSON body limit. NOTE: @fastify/multipart enforces its own `fileSize`
    // for multipart/form-data (see below), so this does NOT cap PDF uploads.
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

  // Multipart uploads (inbox PDF capture). Limits are enforced per-request in
  // the controller too; this is the hard ceiling. 1 file, 10MB.
  await fastify.register(multipart, {
    limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 4 },
  })

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
