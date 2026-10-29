# syntax=docker/dockerfile:1

# Images for apps/api, apps/mcp-server and apps/web, built from the whole
# monorepo: docker build --target api|mcp-server|web .
# docker-compose.yml runs them together. Each image keeps the repo layout under
# /app, because paths such as data/health.db resolve from the repo root.

ARG NODE_VERSION=26

# --- Base: Node and the repo's pinned Yarn release (.yarn/releases) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1

# --- Install every dependency (needed to build) ------------------------------
FROM base AS deps
# Compilers for native modules (better-sqlite3) when no prebuilt binary fits.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Only the manifests, so this layer is reused until a dependency changes.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases
COPY apps/api/package.json apps/api/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/evals/package.json packages/evals/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    node .yarn/releases/yarn-*.cjs install --immutable

# --- Build every workspace ---------------------------------------------------
FROM deps AS build
COPY . .
RUN node .yarn/releases/yarn-*.cjs build

# --- Production dependencies of the api and the MCP server -------------------
FROM deps AS server-deps
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    node .yarn/releases/yarn-*.cjs workspaces focus \
      @health-mcp/api @health-mcp/mcp-server --production

# --- Shared runtime for the api and the MCP server ---------------------------
FROM base AS server
ENV NODE_ENV=production
COPY --from=server-deps /app/node_modules node_modules
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY packages/db/package.json packages/db/
COPY packages/db/drizzle packages/db/drizzle
COPY --from=build /app/packages/db/dist packages/db/dist
# data/ (database, imaging) is a volume; the app runs as the unprivileged node user.
RUN mkdir -p data && chown node:node data
USER node
VOLUME ["/app/data"]

FROM server AS api
COPY apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]

FROM server AS mcp-server
COPY apps/mcp-server/package.json apps/mcp-server/
COPY --from=build /app/apps/mcp-server/dist apps/mcp-server/dist
EXPOSE 3002
CMD ["node", "apps/mcp-server/dist/main.js"]

# --- Web: Next.js standalone output (its own minimal node_modules) -----------
FROM base AS web
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
