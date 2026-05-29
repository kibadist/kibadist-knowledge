# Kibadist Knowledge — Monorepo Starter

Cognitive OS for the AI era. **AI asks questions. Humans build understanding.**

This repo is the infrastructure kick-starter for the [Kibadist Knowledge MVP](https://linear.app/detailing-app/project/kibadist-knowledge-mvp-70c34a762243/overview).
It mirrors the conventions of the `detailing-app` monorepo, distilled to a minimal,
working baseline: a NestJS API with Passport.js auth, a Prisma/PostgreSQL data layer,
and a Next.js frontend.

## Stack

| Layer      | Tech                                                                 |
| ---------- | -------------------------------------------------------------------- |
| Monorepo   | pnpm workspaces + Turborepo                                          |
| Formatting | Biome (formatter only) + Husky pre-commit                            |
| Database   | PostgreSQL 16 + Prisma 6 (`@kibadist/prisma` package)                |
| API        | NestJS 11 on Fastify, nestjs-pino, `@nestjs/config`                  |
| Auth       | Passport.js (`passport-local` + `passport-jwt`), bcrypt, `@nestjs/jwt` |
| Frontend   | Next.js 16 (App Router, React 19), Tailwind v4, TanStack Query       |

## Layout

```
kibadist-knowledge/
├─ packages/prisma/   @kibadist/prisma — schema, generated client, singleton
├─ server/            @kibadist/server — NestJS API + Passport auth
└─ web/               kibadist-web     — Next.js app
```

## Quick start

```bash
# 1. Install
pnpm install

# 2. Start PostgreSQL (Docker)
pnpm db:up

# 3. Configure env
cp server/.env.example server/.env      # then set a real JWT_SECRET
cp web/.env.example web/.env.local

# 4. Generate the Prisma client and push the schema
pnpm build:packages
pnpm db:push

# 5. Run API (:4000) and web (:3000) together
pnpm dev
```

API: http://localhost:4000/api · Health: http://localhost:4000/healthz · Web: http://localhost:3000

## API

All routes are under the `/api` prefix. Every route requires a Bearer JWT
except those marked `@Public()`.

| Method | Path                 | Auth   | Description                     |
| ------ | -------------------- | ------ | ------------------------------- |
| POST   | `/api/auth/register` | public | Create account → access_token   |
| POST   | `/api/auth/login`    | public | Email + password → access_token |
| GET    | `/api/auth/me`       | bearer | Current user profile            |
| GET    | `/api/notes`         | bearer | List the current user's notes   |
| POST   | `/api/notes`         | bearer | Create a note                   |
| GET    | `/healthz`           | public | Liveness probe                  |

```bash
# Smoke test
curl -s -XPOST localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"password123","name":"Ada"}'
```

## Auth design

- A single `User` table stores a bcrypt `passwordHash`.
- `LocalStrategy` validates email + password on `/auth/login`.
- `JwtStrategy` validates the Bearer token on every protected route.
- A global `JwtAuthGuard` (registered via `APP_GUARD`) enforces auth everywhere;
  `@Public()` opts a route out — mirroring the reference project's pattern.

Refresh-token rotation, OAuth, email verification and CSRF (present in the
reference `detailing-app`) are intentionally **out of scope** for this starter.

## Scripts

| Command                  | Description                            |
| ------------------------ | -------------------------------------- |
| `pnpm dev`               | Run server + web via Turbo             |
| `pnpm build`             | Build all workspaces                   |
| `pnpm typecheck`         | Type-check all workspaces              |
| `pnpm format`            | Format with Biome                      |
| `pnpm db:up` / `db:down` | Start / stop PostgreSQL (Docker)       |
| `pnpm db:push`           | Push the Prisma schema to the database |
| `pnpm db:studio`         | Open Prisma Studio                     |
