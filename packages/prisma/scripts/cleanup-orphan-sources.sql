-- One-off cleanup: delete TransformerSources orphaned by the pre-fix discard
-- behavior. Before "Delete the companion source when a capture is removed",
-- discarding an inbox item deleted only the Concept row and left its companion
-- TransformerSource (DET-300) — plus blocks, generated article, and
-- illustration images — in the DB forever.
--
-- ORPHAN = a source that is now UNREACHABLE from the product: no Concept
-- references it via `sourceId` (neither an INBOX item nor an earned concept,
-- which keeps its sourceId after promotion-in-place), AND no earned Concept
-- references one of its articles via `originArticleId` (the DET-283 provenance
-- back-link). Sources are reachable in the UI only through these links
-- (listTransformerSources backs no page), so anything matching is dead data.
--
-- Blocks, articles, and illustration images are removed by the existing DB
-- cascade on transformer_sources. Earned knowledge (concept rows) is NEVER
-- matched by the predicate, so it is never touched.
--
-- Idempotent and safe to re-run on any environment (dev / DO prod): once clean
-- it deletes nothing. Run with:
--   psql "$DATABASE_URL" -f packages/prisma/scripts/cleanup-orphan-sources.sql

BEGIN;

DELETE FROM transformer_sources s
WHERE NOT EXISTS (
        SELECT 1 FROM concept c WHERE c."sourceId" = s.id
      )
  AND NOT EXISTS (
        SELECT 1
        FROM concept c
        JOIN transformed_articles a ON a.id = c."originArticleId"
        WHERE a."sourceId" = s.id
      );

COMMIT;
