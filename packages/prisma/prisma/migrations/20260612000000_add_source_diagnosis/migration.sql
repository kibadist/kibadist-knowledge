-- Pre-generation source diagnosis (DET-345). A single additive, nullable JSONB
-- column on transformed_articles holding the deterministic SourceKind detection +
-- selected v3 ArticleShape + the signals/scores behind the decision. Computed
-- before generation for EVERY article so it is available to both the v2 and v3
-- pipelines (the v3 router reads `sourceKind` to gate routing; v2 stays default).
-- Old rows stay NULL; no backfill needed.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "sourceDiagnosis" JSONB;
