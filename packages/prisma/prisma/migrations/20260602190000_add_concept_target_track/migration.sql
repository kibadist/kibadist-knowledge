-- Track-first onboarding (DET-240): mark a captured inbox concept with the Track
-- it was routed into, so promotion can auto-enroll the earned concept as an
-- AI-proposed CANDIDATE. Hand-authored (not `migrate dev`-generated) so it
-- deliberately contains NO `DROP INDEX "articulation_embedding_hnsw_idx"` — that
-- HNSW index is hand-written raw SQL Prisma can't model (see the Articulation.
-- embedding schema comment). A single additive, nullable column; no backfill, no
-- FK (a deleted track just makes enrollment a no-op).

-- AlterTable
ALTER TABLE "concept" ADD COLUMN "targetTrackId" TEXT;
