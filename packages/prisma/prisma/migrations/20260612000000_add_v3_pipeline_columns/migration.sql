-- Source-Grounded Learning Article Engine v3 (DET-343). Three additive, nullable
-- columns on transformed_articles so the v3 pipeline can run BESIDE v2 (strangler
-- pattern) without touching v2's columns or the v2 read boundary:
--   - pipelineVersion: which engine produced the row ('v2' | 'v3'); NULL ⇒ v2.
--   - articleJsonV3:   the Article JSON v3 document (learning-first, source-grounded).
--   - qualityReport:   the v3 quality-gate verdict (coverage, unsupported claims,
--                      concept candidates, blockers, derived v3 status).
-- Old rows stay NULL; no backfill needed. No enum change — the row `status` keeps
-- mapping onto the existing TransformedArticleStatus.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "pipelineVersion" TEXT;
ALTER TABLE "transformed_articles" ADD COLUMN "articleJsonV3" JSONB;
ALTER TABLE "transformed_articles" ADD COLUMN "qualityReport" JSONB;
