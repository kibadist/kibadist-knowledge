-- Cognitive state machine (DET-194), part 2 of 2: backfill, enforce, and add the
-- transition log. The enum values were added in the preceding migration so they
-- are safe to use here (separate transaction).
--
-- NOTE: Prisma also generated `DROP INDEX "articulation_embedding_hnsw_idx";`
-- here because the HNSW vector index is hand-written raw SQL it can't model (see
-- the MIGRATION LANDMINE note on Articulation.embedding in schema.prisma). It was
-- intentionally removed so semantic search keeps working.

-- Backfill existing rows before making cognitiveState required. Every concept
-- must have a state (DET-194). Articulated-but-unpromoted rows map to EXPLAINED;
-- everything else still in the inbox is SEEN.
UPDATE "concept" SET "cognitiveState" = 'EXPLAINED' WHERE "cognitiveState" IS NULL AND "status" = 'ARTICULATED';
UPDATE "concept" SET "cognitiveState" = 'SEEN' WHERE "cognitiveState" IS NULL;

-- AlterTable
ALTER TABLE "concept" ALTER COLUMN "cognitiveState" SET NOT NULL,
ALTER COLUMN "cognitiveState" SET DEFAULT 'SEEN';

-- CreateTable
CREATE TABLE "concept_state_transition" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "from" "CognitiveState",
    "to" "CognitiveState" NOT NULL,
    "trigger" "StateTrigger" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_state_transition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "concept_state_transition_conceptId_createdAt_idx" ON "concept_state_transition"("conceptId", "createdAt");

-- CreateIndex
CREATE INDEX "concept_state_transition_userId_idx" ON "concept_state_transition"("userId");

-- CreateIndex
CREATE INDEX "concept_userId_cognitiveState_idx" ON "concept"("userId", "cognitiveState");

-- AddForeignKey
ALTER TABLE "concept_state_transition" ADD CONSTRAINT "concept_state_transition_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_state_transition" ADD CONSTRAINT "concept_state_transition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
