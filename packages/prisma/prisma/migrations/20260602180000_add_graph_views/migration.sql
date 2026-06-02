-- GraphView (DET-236): saved, scoped lenses over the live Concept/Link graph.
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model, so every `migrate dev` tries to drop it and would
-- silently degrade semantic search (see the Articulation.embedding schema comment).
-- Purely additive: one enum + one table.

-- CreateEnum
CREATE TYPE "GraphScope" AS ENUM ('ARTICLE', 'TRACK', 'DOMAIN', 'WORKSPACE', 'CONCEPT_NEIGHBORHOOD', 'MISCONCEPTION', 'REVIEW');

-- CreateTable: graph_view (scope + target + prefs; nodes/edges resolved live).
CREATE TABLE "graph_view" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "GraphScope" NOT NULL,
    "sourceConceptId" TEXT,
    "trackId" TEXT,
    "domainId" TEXT,
    "centerConceptId" TEXT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "layout" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_view_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "graph_view_workspaceId_idx" ON "graph_view"("workspaceId");

-- AddForeignKey: a view belongs to a workspace (cascade on workspace delete). The
-- scope target fields (trackId/domainId/...) are intentionally NOT foreign keys —
-- a view pointing at a deleted target resolves to an empty graph, never errors.
ALTER TABLE "graph_view" ADD CONSTRAINT "graph_view_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
