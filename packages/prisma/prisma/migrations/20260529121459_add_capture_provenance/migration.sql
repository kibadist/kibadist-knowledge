-- CreateEnum
CREATE TYPE "CaptureSource" AS ENUM ('PASTE', 'URL', 'PDF');

-- AlterTable: capture provenance for the inbox (DET-187).
ALTER TABLE "concept" ADD COLUMN     "captureSource" "CaptureSource",
ADD COLUMN     "sourceUrl" TEXT;

-- NOTE: `prisma migrate dev` also generated a `DROP INDEX
-- "articulation_embedding_hnsw_idx"` here. That was removed by hand. The HNSW
-- vector index (DET-203) lives on an `Unsupported("vector(1536)")` column, so
-- Prisma can't model it and reports it as drift on every `migrate dev`. Dropping
-- it would silently destroy semantic-search performance. See the warning next to
-- `Articulation.embedding` in schema.prisma: future migrations must strip any
-- auto-generated DROP of this index.
