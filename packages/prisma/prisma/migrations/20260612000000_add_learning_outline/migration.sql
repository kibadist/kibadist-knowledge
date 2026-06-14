-- Learning-first article outline lane (DET-348). A single additive, nullable JSONB
-- column on transformed_articles — a sibling of `reshapingPlan`/`editorialLayout`:
-- it carries the teaching outline (learning path, concept-led sections, source
-- furniture demoted to source notes) the rewrite stage writes prose against. It
-- only references existing source block/segment ids. Old rows stay NULL; no
-- backfill needed.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "learningOutline" JSONB;
