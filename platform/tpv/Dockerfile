FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/tpv/package.json          ./platform/tpv/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-tpv...

COPY packages/platform-sdk     ./packages/platform-sdk
COPY platform/tpv/src          ./platform/tpv/src
COPY platform/tpv/migrations   ./platform/tpv/migrations

WORKDIR /app/platform/tpv
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/tpv/package.json          ./platform/tpv/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-tpv...

COPY packages/platform-sdk     ./packages/platform-sdk
COPY platform/tpv/src          ./platform/tpv/src
COPY platform/tpv/migrations   ./platform/tpv/migrations

WORKDIR /app/platform/tpv
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3500/health || exit 1
CMD ["node", "src/server.js"]
