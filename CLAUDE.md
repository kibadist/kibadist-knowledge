# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kibadist Knowledge — a "Cognitive OS" learning app. Users ingest source material (URLs, PDFs, text); an LLM pipeline transforms it into structured articles and concept candidates; users learn concepts through reading modes, sessions, retrieval, and spaced review; knowledge decays and gets reinforced over time. Work is tracked in Linear (team DET — ticket IDs appear in commits and code comments).

## Commands

```bash
pnpm install
pnpm db:up                  # start PostgreSQL 16 (Docker)
pnpm build:packages         # generate Prisma client (needed before first dev run)
pnpm dev                    # API on :4000 + web on :3000 via Turbo

pnpm build                  # build all workspaces
pnpm typecheck              # type-check all workspaces
pnpm test                   # all tests (server jest + web vitest)
pnpm format                 # Biome (also runs on pre-commit via husky)
```

Run a single test:

```bash
pnpm -F @kibadist/server test decay.service        # jest, pattern matches file path
pnpm -F kibadist-web test src/components/transformer/__tests__/article-view.test.tsx
```

### Database / Prisma

Schema lives in `packages/prisma/prisma/schema.prisma`; the generated client is built into the `@kibadist/prisma` package (`pnpm build:packages` after schema changes).

- **Use migrations, not db:push**: `pnpm -F @kibadist/prisma migrate:dev` (loads `server/.env`). `db:push` exists but the workflow is migration-based; the dev DB has known drift from old `db:push` use.
- **HNSW migration landmine**: `Articulation.embedding` is `Unsupported("vector(1536)")` with a hand-written raw-SQL HNSW index (`articulation_embedding_hnsw_idx`) that Prisma can't see. `migrate dev` will add a `DROP INDEX` line to generated migrations — **strip it by hand** (documented in the schema file).
- Server env comes from `server/.env` (see `.env.example`); web from `web/.env.local`. `OPENAI_API_KEY` is required for AI features.

## Architecture

pnpm workspaces + Turborepo, three workspaces:

- `packages/prisma` — `@kibadist/prisma`: schema, generated client, Prisma singleton. Other packages import the client from here, never from `@prisma/client` directly.
- `server` — `@kibadist/server`: NestJS 11 on Fastify, port 4000, global `/api` prefix (`/healthz` is unprefixed).
- `web` — `kibadist-web`: Next.js 16 App Router, React 19, port 3000.

### Server

One NestJS module per domain area under `server/src/`. The content pipeline flows roughly:

**intake/inbox** (capture) → **source-document** (URL/PDF/text → blocks + chunks; Readability, unpdf) → **transformer** (multi-stage LLM pipeline) → **concepts** + concept candidates → **promotion** (gates: candidate → real concept) → learning loop (**sessions**, **retrieval**, **decay**, **reflection**, **tutor**, **concept-state**) → **graph** / **metrics**.

Cross-cutting patterns:

- **Auth**: global `JwtAuthGuard` via `APP_GUARD`; every route requires a Bearer JWT unless decorated `@Public()`. Passport local (login/register) + JWT strategies.
- **Rate limiting**: `UserThrottlerGuard` registered *after* the auth guard (order matters — it keys on `req.user`). Two named throttlers: `default` (120/user/min) and `ai` (20/user/min); paid OpenAI-backed endpoints must opt in via `@Throttle({ ai: ... })`.
- **Workspaces**: requests are scoped by the `X-Workspace-Id` header; the server validates it and falls back to the user's default workspace.
- **AI layer** (`server/src/ai`): all LLM/embedding/image calls go through `AiService` behind `ai-provider.interface.ts`. Only the OpenAI provider is implemented (`AI_PROVIDER=openai`); ollama is a seam.
- **Transformer conventions** (`server/src/transformer`, the largest module): each pipeline stage splits into `*.prompt.ts` (prompt construction), `*.service.ts` (LLM call + orchestration), and pure `*.util.ts` helpers — utils and prompts have colocated `*.spec.ts` tests, plus golden-fixture tests in `__fixtures__`. LLM JSON responses are parsed via `llm-json.util.ts` and validated with zod (`schemas.ts`).

### Web

- `web/src/app/(app)/` is the authenticated app shell (concepts, inbox, transformer, deep-reading, reader, graph, session, tracks, domains, metrics); `login`/`register`/landing live outside the group.
- All API access goes through `web/src/lib/api.ts`: fetch wrappers that attach the Bearer token (localStorage `kibadist_token`) and `X-Workspace-Id`, throwing `ApiError`. Server state via TanStack Query; auth and workspace state via React contexts in `web/src/lib`.
- **Shared contracts**: `web/src/lib/article-v2.ts` (Article JSON v2) and `article-learning-events.ts` mirror server-side shapes — keep both sides in sync when changing them.
- Rich text uses Lexical (`components/editor`); the graph uses `@xyflow/react` (`components/graph`).
- **Design is light-only** — an "editorial manuscript" paper theme. Tokens live in `web/src/app/globals.css` scoped under `.kbapp`. Do not add dark mode.

### Testing

- Server: jest + ts-jest, `*.spec.ts` colocated with source. Heavy emphasis on testing pure utils and prompt builders without network.
- Web: vitest + jsdom + testing-library, `src/**/*.{test,spec}.{ts,tsx}`. No network in tests — render against in-repo fixture articles only (see `vitest.config.ts`).

## Conventions

- Biome is **formatter only** (linter disabled; `lint` scripts are no-ops): single quotes, no semicolons (`asNeeded`), 80-col lines, 2-space indent.
- Comments throughout the codebase explain *why* and reference DET tickets; match that style for non-obvious decisions.
- Deployment is DigitalOcean App Platform (path-based ingress, managed Postgres) — see `DEPLOY.md` and the env-var notes in `server/.env.example`.
