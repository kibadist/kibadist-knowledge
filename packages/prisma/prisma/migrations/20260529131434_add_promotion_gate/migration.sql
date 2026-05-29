-- CreateEnum
CREATE TYPE "GateMode" AS ENUM ('QUICK', 'DEEP');

-- CreateEnum
CREATE TYPE "CognitiveState" AS ENUM ('EXPLAINED', 'LINKED');

-- NOTE: Prisma regenerates a `DROP INDEX "articulation_embedding_hnsw_idx"` here
-- on every `migrate dev` because the HNSW vector index is hand-written raw SQL it
-- cannot model (see schema.prisma's Articulation.embedding landmine comment). The
-- drop is intentionally removed so semantic search keeps working.

-- AlterTable
ALTER TABLE "concept" ADD COLUMN     "cognitiveState" "CognitiveState",
ADD COLUMN     "gateMode" "GateMode";

-- CreateTable
CREATE TABLE "promotion_draft" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "GateMode" NOT NULL DEFAULT 'QUICK',
    "articulation" TEXT,
    "retrievalQuestion" TEXT,
    "retrievalResponse" TEXT,
    "retrievalScore" INTEGER,
    "retrievalPassed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promotion_draft_conceptId_key" ON "promotion_draft"("conceptId");

-- CreateIndex
CREATE INDEX "promotion_draft_userId_idx" ON "promotion_draft"("userId");

-- AddForeignKey
ALTER TABLE "promotion_draft" ADD CONSTRAINT "promotion_draft_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_draft" ADD CONSTRAINT "promotion_draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
