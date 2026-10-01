# syntax=docker/dockerfile:1.7
#
# One multi-stage build for the whole monorepo. Targets:
#   indexer  - block indexer (+ migration runner)
#   api      - Fastify API
#   web      - Next.js standalone server
#
# API and indexer are bundled by tsup into self-contained ESM files, so their runtime
# images contain only Node.js, the bundle and the SQL migrations.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY packages/blockchain/package.json packages/blockchain/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
COPY apps/indexer/package.json apps/indexer/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
# Baked into the client bundle: the API URL as reached from users' browsers.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=@eoi/indexer \
 && npm run build --workspace=@eoi/api \
 && npm run build --workspace=@eoi/web

FROM node:${NODE_VERSION} AS node-runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
USER node
ENTRYPOINT ["/sbin/tini", "--"]

FROM node-runtime AS indexer
COPY --from=build --chown=node:node /repo/apps/indexer/dist ./dist
COPY --from=build --chown=node:node /repo/packages/database/drizzle ./drizzle
ENV MIGRATIONS_DIR=/app/drizzle
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD wget -qO- http://127.0.0.1:${INDEXER_HEALTH_PORT:-4100}/health || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM node-runtime AS api
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${API_PORT:-4000}/health || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM node-runtime AS web
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1
CMD ["node", "apps/web/server.js"]
