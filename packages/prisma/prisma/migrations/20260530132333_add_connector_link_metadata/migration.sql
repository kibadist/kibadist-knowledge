-- Connector agent link metadata (DET-191).
--
-- NOTE: Prisma generated a `DROP INDEX "articulation_embedding_hnsw_idx";` here
-- because the HNSW vector index is hand-written raw SQL it can't model (see the
-- MIGRATION LANDMINE note on Articulation.embedding in schema.prisma). It was
-- intentionally removed so semantic search keeps working.

-- CreateEnum
CREATE TYPE "LinkRelation" AS ENUM ('ANALOGY', 'CONTRADICTION', 'SUPPORTS', 'DEPENDS_ON', 'REFINES', 'REDUNDANT');

-- AlterTable: typed relationship + AI rationale + proposer provenance. All
-- additive; existing rows get proposedBy=USER (a pre-existing QuestionActor),
-- relationKind/rationale stay null.
ALTER TABLE "link" ADD COLUMN     "proposedBy" "QuestionActor" NOT NULL DEFAULT 'USER',
ADD COLUMN     "rationale" TEXT,
ADD COLUMN     "relationKind" "LinkRelation";
