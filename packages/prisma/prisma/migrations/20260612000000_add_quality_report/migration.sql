-- Fidelity-review rollup for the v3 quality report (DET-354). A single additive,
-- nullable JSONB column on transformed_articles — a sibling of `coverageReport`
-- and `learningLayer`: it carries the ArticleQualityReportV3 (raw vs important
-- source coverage, unsupported-addition / lost-info counts, blocker reasons +
-- stage-targeted regeneration hints), never article substance, and only
-- references existing ids. Old rows stay NULL; no backfill needed.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "qualityReport" JSONB;
