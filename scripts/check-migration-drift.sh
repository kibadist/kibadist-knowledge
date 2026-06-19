#!/usr/bin/env bash
#
# Guard against the class of bug that left prod missing
# `transformed_articles.enrichment`: a column/model added to schema.prisma with
# NO backing migration. `db:push` papers over it on dev, but prod runs
# `migrate deploy` and 500s on the missing structure.
#
# How: replay the committed migrations into a throwaway shadow database, diff the
# result against schema.prisma, and fail if anything other than the hand-written
# HNSW pgvector index remains. That index is the ONLY thing Prisma can't model
# (it lives in raw migration SQL, absent from the datamodel), so the diff always
# emits a spurious `DROP INDEX "articulation_embedding_hnsw_idx"` we ignore.
# Anything else = schema declares structure no migration creates = real drift.
#
# Local use:
#   SHADOW_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kb_shadow \
#     bash scripts/check-migration-drift.sh
# (point SHADOW_DATABASE_URL at an EMPTY throwaway db — Prisma resets it.)
#
# See project-prisma-migration-workflow.
set -euo pipefail

SHADOW="${SHADOW_DATABASE_URL:?set SHADOW_DATABASE_URL to an empty throwaway postgres database}"
# migrate diff needs DATABASE_URL set merely to parse the datasource block.
export DATABASE_URL="${DATABASE_URL:-$SHADOW}"

cd "$(dirname "$0")/../packages/prisma"

diff="$(pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW" \
  --script)"

# Drop SQL comments + blank lines, then the one legitimate residual.
residual="$(printf '%s\n' "$diff" \
  | grep -vE '^[[:space:]]*(--.*)?$' \
  | grep -vxF 'DROP INDEX "articulation_embedding_hnsw_idx";' || true)"

if [ -n "$residual" ]; then
  echo "✖ Prisma drift: schema.prisma declares structure that no migration creates."
  echo "  Add one:  pnpm -F @kibadist/prisma migrate:dev --name <name>"
  echo "  ...then delete the DROP INDEX \"articulation_embedding_hnsw_idx\" line it"
  echo "  generates (hand-written HNSW index — see schema.prisma)."
  echo "--- uncovered changes (migrations -> schema.prisma) ---"
  printf '%s\n' "$residual"
  exit 1
fi

echo "✓ Migrations fully cover schema.prisma (HNSW index residual ignored)."
