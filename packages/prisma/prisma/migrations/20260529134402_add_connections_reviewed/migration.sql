-- NOTE: Prisma's spurious `DROP INDEX "articulation_embedding_hnsw_idx"` removed
-- here — the HNSW vector index is hand-written raw SQL it can't model (see the
-- Articulation.embedding landmine comment in schema.prisma). Dropping it would
-- silently degrade semantic search.

-- AlterTable
ALTER TABLE "promotion_draft" ADD COLUMN     "connectionsReviewed" BOOLEAN NOT NULL DEFAULT false;
