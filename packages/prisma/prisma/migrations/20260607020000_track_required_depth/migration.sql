-- Gentler defaults (DET-311): a track-level default required depth, so the
-- promotion gate can PULL a concept's earning friction up when it is being
-- earned into a deeper track (see server/src/promotion/friction.ts). Demand
-- only — it never changes gate semantics or a concept's CognitiveState.
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is
-- hand-written raw SQL Prisma can't model and every `migrate dev` tries to drop
-- it (see the Articulation.embedding schema comment). A single additive column
-- with a default; no backfill needed (existing rows take 'EXPLAIN').

-- AlterTable
ALTER TABLE "track" ADD COLUMN "requiredDepth" "RequiredDepth" NOT NULL DEFAULT 'EXPLAIN';
