-- Unified capture (DET-300): link an inbox Concept to the TransformerSource
-- captured alongside it. Plain id (no FK), mirroring originArticleId.
-- AlterTable
ALTER TABLE "concept" ADD COLUMN "sourceId" TEXT;
