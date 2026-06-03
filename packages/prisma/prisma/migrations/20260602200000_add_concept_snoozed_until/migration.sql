-- Inbox snooze (DET-241): hide a captured inbox concept until a later moment,
-- then let it resurface. Hand-authored (not `migrate dev`-generated) to follow
-- this project's convention and avoid touching the hand-written HNSW vector index
-- Prisma can't model. A single additive, nullable column plus the index the inbox
-- visibility filter reads; no backfill (null = visible now).

-- AlterTable
ALTER TABLE "concept" ADD COLUMN "snoozedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "concept_workspaceId_status_snoozedUntil_idx" ON "concept"("workspaceId", "status", "snoozedUntil");
