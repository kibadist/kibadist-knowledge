# syntax=docker/dockerfile:1
# Production image for the NestJS API (@kibadist/server) in this pnpm monorepo.
# Debian-based so Prisma's native query engine matches build and runtime.

# ---- Base: Node 20 + pnpm via corepack ---------------------------------------
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# OpenSSL + CA certs are required by Prisma's query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- Build: install workspace, generate Prisma client, compile server --------
FROM base AS build
# Install with only the manifests first so the dependency layer caches well.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/prisma/package.json packages/prisma/
COPY server/package.json server/
COPY web/package.json web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Bring in the rest of the source (node_modules/dist excluded via .dockerignore).
COPY . .
# Generate the Prisma client (native engine for this image) + build the package,
# then compile the NestJS server.
RUN pnpm -F @kibadist/prisma build \
  && pnpm -F @kibadist/server build

# ---- Runner: production runtime ----------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
# Keeps the workspace layout so node_modules symlinks + @kibadist/prisma resolve,
# and ships the Prisma schema/migrations for `migrate deploy` at release time.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/server ./server
# Drop privileges (the node image ships an unprivileged `node` user).
USER node
EXPOSE 4000
CMD ["node", "server/dist/main.js"]
