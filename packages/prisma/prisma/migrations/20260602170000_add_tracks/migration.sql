-- Tracks (DET-235): the goal-directed organizational layer + the TrackConcept
-- join carrying per-track required depth. Hand-authored (not `migrate dev`-
-- generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model, so every `migrate dev` tries to drop it and would
-- silently degrade semantic search (see the Articulation.embedding schema comment).
-- Purely additive: new enums + tables, nothing existing is altered.

-- CreateEnum
CREATE TYPE "TrackType" AS ENUM ('LEARNING', 'RESEARCH', 'PROJECT', 'CAREER', 'COURSE', 'PAPER_REVIEW', 'PRODUCT_BUILDING');
CREATE TYPE "TrackStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "ImportanceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "RequiredDepth" AS ENUM ('RECOGNIZE', 'EXPLAIN', 'APPLY', 'TEACH');
CREATE TYPE "TrackConceptStatus" AS ENUM ('CANDIDATE', 'ACCEPTED', 'COMPLETED', 'SKIPPED');

-- CreateTable: track (goal-directed, workspace-owned).
CREATE TABLE "track" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "TrackType" NOT NULL,
    "goal" TEXT,
    "status" "TrackStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "track_workspaceId_status_idx" ON "track"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "track" ADD CONSTRAINT "track_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: track_concept (membership + per-track demand; progress is derived).
CREATE TABLE "track_concept" (
    "trackId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "orderIndex" INTEGER,
    "importance" "ImportanceLevel" NOT NULL DEFAULT 'MEDIUM',
    "requiredDepth" "RequiredDepth" NOT NULL DEFAULT 'EXPLAIN',
    "status" "TrackConceptStatus" NOT NULL DEFAULT 'CANDIDATE',
    "createdBy" "Generator" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_concept_pkey" PRIMARY KEY ("trackId","conceptId")
);

-- CreateIndex
CREATE INDEX "track_concept_trackId_idx" ON "track_concept"("trackId");
CREATE INDEX "track_concept_conceptId_idx" ON "track_concept"("conceptId");
CREATE INDEX "track_concept_trackId_orderIndex_idx" ON "track_concept"("trackId", "orderIndex");

-- AddForeignKey: deleting a track drops its memberships; deleting a concept drops
-- its memberships — neither ever deletes the other entity (a track organizes, it
-- doesn't contain). This is how "delete a track → drop TrackConcept rows, never
-- the concepts" holds.
ALTER TABLE "track_concept" ADD CONSTRAINT "track_concept_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "track_concept" ADD CONSTRAINT "track_concept_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;
