-- CreateEnum
CREATE TYPE "ChunkKind" AS ENUM ('MAIN_IDEA', 'DEFINITION', 'EXAMPLE', 'APPLICATION', 'HISTORY', 'REFERENCE', 'NOISE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChunkImportance" AS ENUM ('CORE', 'SUPPORTING', 'PERIPHERAL');

-- CreateEnum
CREATE TYPE "CandidateKind" AS ENUM ('CONCEPT', 'TERM', 'PERSON', 'METHOD', 'FORMULA', 'THEOREM', 'APPLICATION');

-- CreateEnum
CREATE TYPE "CandidateImportance" AS ENUM ('CORE', 'SUPPORTING', 'PREREQUISITE', 'PERIPHERAL');

-- CreateEnum
CREATE TYPE "Generator" AS ENUM ('SYSTEM', 'AI', 'USER');

-- CreateEnum
CREATE TYPE "CandidatePromotionStatus" AS ENUM ('CANDIDATE', 'DISMISSED', 'PROMOTED');

-- CreateTable
CREATE TABLE "source_chunk" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "blockIds" TEXT[],
    "kind" "ChunkKind" NOT NULL DEFAULT 'OTHER',
    "importance" "ChunkImportance" NOT NULL DEFAULT 'SUPPORTING',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_concept_candidate" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkId" TEXT,
    "label" TEXT NOT NULL,
    "definition" TEXT,
    "aliases" TEXT[],
    "sourceBlockIds" TEXT[],
    "kind" "CandidateKind" NOT NULL DEFAULT 'CONCEPT',
    "importance" "CandidateImportance" NOT NULL DEFAULT 'SUPPORTING',
    "generatedBy" "Generator" NOT NULL DEFAULT 'AI',
    "promotionStatus" "CandidatePromotionStatus" NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_concept_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_chunk_conceptId_position_idx" ON "source_chunk"("conceptId", "position");

-- CreateIndex
CREATE INDEX "source_chunk_userId_idx" ON "source_chunk"("userId");

-- CreateIndex
CREATE INDEX "source_concept_candidate_conceptId_idx" ON "source_concept_candidate"("conceptId");

-- CreateIndex
CREATE INDEX "source_concept_candidate_userId_idx" ON "source_concept_candidate"("userId");

-- CreateIndex
CREATE INDEX "source_concept_candidate_conceptId_promotionStatus_idx" ON "source_concept_candidate"("conceptId", "promotionStatus");

-- AddForeignKey
ALTER TABLE "source_chunk" ADD CONSTRAINT "source_chunk_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_chunk" ADD CONSTRAINT "source_chunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_concept_candidate" ADD CONSTRAINT "source_concept_candidate_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_concept_candidate" ADD CONSTRAINT "source_concept_candidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
