# syntax=docker/dockerfile:1
# Production image for the Next.js web app (kibadist-web) in this pnpm monorepo.
# Build context must be the REPO ROOT (the workspace lockfile lives there).

# ---- Base: Node 20 + pnpm via corepack ---------------------------------------
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- Build: install workspace, compile the standalone Next bundle ------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/prisma/package.json packages/prisma/
COPY server/package.json server/
COPY web/package.json web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so the
# API URL must be supplied as a build arg (set it in the App Platform spec).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm -F kibadist-web build

# ---- Runner: production runtime ----------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# `output: 'standalone'` emits a self-contained server (minimal node_modules +
# server.js) mirroring the workspace layout, so the entrypoint is web/server.js.
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
USER node
EXPOSE 3000
CMD ["node", "web/server.js"]
