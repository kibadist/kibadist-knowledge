# Deploying Kibadist Knowledge (DigitalOcean App Platform)

The whole stack runs on DigitalOcean App Platform:

| Component | What | Port | Build |
|-----------|------|------|-------|
| `api` | NestJS (Fastify) API | 4000 | `Dockerfile` (repo root) |
| `web` | Next.js app (standalone) | 3000 | `web/Dockerfile` |
| `db` | Managed PostgreSQL 16 + pgvector | — | platform-managed |

Everything is described declaratively in [`.do/app.yaml`](.do/app.yaml). A
`PRE_DEPLOY` job runs `prisma migrate deploy` against the managed DB before each
release.

> Scope: this repo ships the **deploy config**. The steps below are the actual
> deploy, run by a maintainer with a DigitalOcean account (it creates billable
> resources).

---

## Prerequisites

- A DigitalOcean account + [`doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/) authenticated: `doctl auth init`.
- The GitHub repo `kibadist/kibadist-knowledge` connected to DigitalOcean
  (Apps → GitHub authorization), since the spec deploys from `main`.
- An OpenAI API key (for the AI layer / embeddings).

---

## 1. Create the app

```bash
doctl apps create --spec .do/app.yaml
```

This provisions the managed Postgres `db`, the `api` and `web` services, and the
`migrate` pre-deploy job. Grab the app id:

```bash
doctl apps list
```

## 2. Set the secrets

The spec ships placeholders for the two secrets. Set real values (App → Settings
→ the `api` component → Environment Variables), or edit the spec and re-apply:

- `JWT_SECRET` — generate one: `openssl rand -hex 64`
- `OPENAI_API_KEY` — your OpenAI key

`DATABASE_URL` and `CORS_ORIGINS`/`NEXT_PUBLIC_API_URL` are wired automatically
via the `${db.DATABASE_URL}`, `${web.PUBLIC_URL}`, and `${api.PUBLIC_URL}`
bindings — no manual entry needed.

## 3. pgvector / the database

The spec provisions a **dedicated managed PostgreSQL cluster**
(`databases[0].production: true`, smallest size `db-s-1vcpu-1gb`). This is a
paid resource (~$15/mo) and is deliberate: the app requires the pgvector
extension, and DigitalOcean's shared **dev** databases don't reliably allow
`CREATE EXTENSION vector`. The `migrate` job runs
`CREATE EXTENSION IF NOT EXISTS "vector"` on first deploy.

To resize or change the DB, edit `databases[0]` and re-apply:

```bash
doctl apps update <app-id> --spec .do/app.yaml
```

## 4. Deploy

`deploy_on_push: true` redeploys on every push to `main`. To trigger manually:

```bash
doctl apps create-deployment <app-id>
```

Deploy order handled by the platform: build images → run `migrate` (PRE_DEPLOY)
→ roll out `api` + `web`.

---

## 5. Verify (acceptance check)

```bash
doctl apps get <app-id>            # note the api + web public URLs

# API liveness
curl https://<api-url>/healthz

# End-to-end auth against the deployed API
curl -X POST https://<api-url>/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"password123"}'
```

Then open the **web** URL, register/sign in through the UI, and confirm the
authenticated shell loads — this exercises the deployed frontend → deployed API
→ managed DB path (the ticket's DoD).

---

## Notes & follow-ups

- **CORS**: the API allows only `${web.PUBLIC_URL}` (via `CORS_ORIGINS`). If you
  add a custom domain, add it to `CORS_ORIGINS`.
- **Image size**: the API image keeps dev dependencies so the Prisma CLI is
  available for `migrate deploy`. A future optimization is a pruned runtime
  image plus a dedicated migration image.
- **Secrets**: never commit real secrets. `server/.env` / `web/.env.local` are
  gitignored; only `.env.example` placeholders live in git.
- **Tokens in localStorage**: the web app stores the JWT in `localStorage`
  (documented XSS tradeoff in `web/src/lib/api.ts`). Consider httpOnly cookies
  before a real production launch.
