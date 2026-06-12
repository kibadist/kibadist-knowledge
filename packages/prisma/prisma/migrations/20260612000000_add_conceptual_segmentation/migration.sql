-- Conceptual segmentation lane (DET-347). A single additive, nullable JSONB column
-- on transformed_articles holding the ordered SourceSegment[] (plus the
-- unsegmentedBlocks coverage audit) produced between the structure model and the
-- reshaping plan. It groups the classified source blocks into coherent learning
-- segments so the outline builds sections from whole concepts instead of isolated
-- blocks; the segment→block mapping is persisted for the coverage/fidelity reports.
-- Old rows stay NULL — the pipeline degrades to no-segmentation around a failure,
-- so no backfill is needed.
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterTable
ALTER TABLE "transformed_articles" ADD COLUMN "segments" JSONB;
