import { Injectable, Logger } from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { PrismaService } from '../prisma/prisma.service'

/** Embedding width for OpenAI text-embedding-3-small; matches vector(1536). */
const EMBEDDING_DIMS = 1536

export interface ArticulationMatch {
  id: string
  conceptId: string
  body: string
  createdAt: Date
  /**
   * Cosine similarity = 1 - cosine distance. Theoretically in [-1, 1]; for
   * real text embeddings it stays positive. Higher is more similar.
   */
  similarity: number
}

/**
 * Vector-store boundary for articulations: embeds text via the AI seam
 * (DET-202) and persists/queries the pgvector `embedding` column. The column
 * is Prisma `Unsupported`, so all vector I/O goes through raw SQL here.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  /**
   * Embed `text` and store it on the articulation. Best-effort: a failure
   * (e.g. AI provider down) is logged, not thrown, so the domain write is
   * never lost — the embedding can be backfilled later.
   */
  async indexArticulation(articulationId: string, text: string): Promise<void> {
    try {
      const literal = await this.embedToVectorLiteral(text)
      if (!literal) return
      await this.prisma.$executeRaw`
        UPDATE "articulation"
        SET "embedding" = ${literal}::vector
        WHERE "id" = ${articulationId}
      `
    } catch (error) {
      this.logger.warn(
        `Failed to embed articulation ${articulationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  /**
   * Return the user's articulations most semantically similar to `query`,
   * ordered by cosine distance using the HNSW index.
   */
  async searchArticulations(
    userId: string,
    query: string,
    limit = 10,
  ): Promise<ArticulationMatch[]> {
    const literal = await this.embedToVectorLiteral(query)
    if (!literal) return []
    return this.prisma.$queryRaw<ArticulationMatch[]>`
      SELECT
        a."id",
        a."conceptId",
        a."body",
        a."createdAt",
        1 - (a."embedding" <=> ${literal}::vector) AS similarity
      FROM "articulation" a
      WHERE a."userId" = ${userId} AND a."embedding" IS NOT NULL
      ORDER BY a."embedding" <=> ${literal}::vector
      LIMIT ${limit}
    `
  }

  /**
   * Embeds text and formats the vector as a pgvector literal: "[v1,v2,...]".
   * Guards dimension and finiteness so a malformed provider response can't
   * produce an invalid `::vector` cast (which would otherwise surface as an
   * opaque 500 on search or a silent no-op on write).
   */
  private async embedToVectorLiteral(text: string): Promise<string | null> {
    const { embeddings } = await this.ai.embed({ input: text })
    const vector = embeddings[0]
    if (!vector?.length) return null
    if (vector.length !== EMBEDDING_DIMS || !vector.every(Number.isFinite)) {
      throw new Error(
        `Embedding shape invalid: expected ${EMBEDDING_DIMS} finite numbers, got ${vector.length}`,
      )
    }
    return `[${vector.join(',')}]`
  }
}
