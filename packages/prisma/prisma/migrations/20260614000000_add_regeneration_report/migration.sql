-- Targeted regeneration audit (DET-356). A single additive, nullable JSONB column
-- on transformed_articles — a sibling of `fidelityReport`/`coverageReport`: it
-- records the repair pass run on a BLOCKED article (blockers before/after, the
-- per-blocker actions with the stage re-run and why, the preserved sections, and a
-- clear outcome explanation). Old rows stay NULL; no backfill needed.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "regenerationReport" JSONB;
