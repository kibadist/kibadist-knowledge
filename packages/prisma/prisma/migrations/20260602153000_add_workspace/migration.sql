-- Workspace tenancy (DET-232): introduce `workspace` and scope the existing
-- per-user knowledge graph under it. Hand-authored (not `migrate dev`-generated)
-- for two reasons:
--   1. The required `concept.workspaceId` is added in two steps (nullable → backfill
--      → SET NOT NULL) so this deploys safely on a populated production DB.
--   2. It deliberately contains NO `DROP INDEX "articulation_embedding_hnsw_idx"`.
--      That HNSW index is hand-written raw SQL Prisma can't model, so every
--      `migrate dev` tries to drop it (see the Articulation.embedding schema
--      comment). Dropping it silently degrades semantic search.

-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_ownerUserId_idx" ON "workspace"("ownerUserId");

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add Concept.workspaceId NULLABLE first so the backfill below can
-- populate it before the NOT NULL invariant is enforced.
ALTER TABLE "concept" ADD COLUMN "workspaceId" TEXT;

-- Backfill: one default workspace per existing user, then point every existing
-- concept at its owner's default workspace. cuid() isn't available in SQL, so
-- ids use gen_random_uuid()::text (PG16 core) — a unique TEXT id is all the
-- column needs; new rows created by the app still get cuid() via Prisma @default.
INSERT INTO "workspace" ("id", "name", "ownerUserId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'My Knowledge', u."id", NOW(), NOW()
FROM "user" u;

UPDATE "concept" c
SET "workspaceId" = w."id"
FROM "workspace" w
WHERE w."ownerUserId" = c."userId";

-- Enforce the invariant now that every concept has a workspace.
ALTER TABLE "concept" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "concept" ADD CONSTRAINT "concept_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: workspace-leading composites for the "concepts in this workspace"
-- hot path (the existing [userId, *] composites are kept in the schema).
CREATE INDEX "concept_workspaceId_idx" ON "concept"("workspaceId");
CREATE INDEX "concept_workspaceId_status_idx" ON "concept"("workspaceId", "status");
CREATE INDEX "concept_workspaceId_nextReviewAt_idx" ON "concept"("workspaceId", "nextReviewAt");
CREATE INDEX "concept_workspaceId_cognitiveState_idx" ON "concept"("workspaceId", "cognitiveState");
