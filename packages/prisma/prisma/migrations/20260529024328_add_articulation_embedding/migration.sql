-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "articulation" ADD COLUMN     "embedding" vector(1536);

-- HNSW index for cosine-distance similarity search (embedding <=> query).
-- Added by hand: Prisma cannot yet express vector index operator classes.
CREATE INDEX "articulation_embedding_hnsw_idx"
    ON "articulation" USING hnsw ("embedding" vector_cosine_ops);
