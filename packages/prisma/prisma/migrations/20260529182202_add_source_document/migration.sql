-- NOTE: Prisma generated a `DROP INDEX "articulation_embedding_hnsw_idx";` here
-- because the HNSW vector index is hand-written raw SQL it can't model (see the
-- MIGRATION LANDMINE note on Articulation.embedding in schema.prisma). It was
-- intentionally removed so semantic search keeps working.

-- AlterTable
ALTER TABLE "concept" ADD COLUMN     "sourceDocument" JSONB;
