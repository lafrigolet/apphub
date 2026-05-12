FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/tenant-config/package.json ./platform/tenant-config/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-tenant-config...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/tenant-config/src ./platform/tenant-config/src
COPY platform/tenant-config/migrations ./platform/tenant-config/migrations

WORKDIR /app/platform/tenant-config
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/tenant-config/package.json ./platform/tenant-config/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-tenant-config...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/tenant-config/src ./platform/tenant-config/src
COPY platform/tenant-config/migrations ./platform/tenant-config/migrations

WORKDIR /app/platform/tenant-config
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3005/health || exit 1
CMD ["node", "src/server.js"]
