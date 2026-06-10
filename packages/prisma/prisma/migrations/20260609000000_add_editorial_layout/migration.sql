-- Generative editorial layout lane for the Compendium render. A single additive,
-- nullable JSONB column on transformed_articles — a sibling of `enrichment`: it
-- carries editorial FURNITURE (kicker, standfirst, sub-heads, pull-quote choice,
-- stat band, marginal notes, figure placements), never article substance, and only
-- references existing ids. Old rows stay NULL; no backfill needed.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "editorialLayout" JSONB;
