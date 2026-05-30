-- Spaced-retrieval schedule fields (DET-192).
--
-- NOTE: Prisma generated a `DROP INDEX "articulation_embedding_hnsw_idx";` here
-- because the HNSW vector index is hand-written raw SQL it can't model (see the
-- MIGRATION LANDMINE note on Articulation.embedding in schema.prisma). It was
-- intentionally removed so semantic search keeps working.

-- AlterTable: additive SM-2 schedule state; existing rows take the defaults.
ALTER TABLE "concept" ADD COLUMN     "reviewEase" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "reviewIntervalDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reviewReps" INTEGER NOT NULL DEFAULT 0;
