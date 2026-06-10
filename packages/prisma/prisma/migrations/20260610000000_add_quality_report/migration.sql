-- Aggregated article quality report (DET-320). A single additive, nullable JSONB
-- column on transformed_articles — code-derived at finalize from the artifacts we
-- already persist (fidelity report, coverage report, articleJson counts); never
-- an LLM output. Old rows stay NULL; no backfill needed.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "qualityReport" JSONB;
