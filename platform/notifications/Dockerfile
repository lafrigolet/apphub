FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/notifications/package.json ./platform/notifications/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-notifications...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/notifications/src ./platform/notifications/src
COPY platform/notifications/migrations ./platform/notifications/migrations

WORKDIR /app/platform/notifications
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/notifications/package.json ./platform/notifications/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-notifications...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/notifications/src ./platform/notifications/src
COPY platform/notifications/migrations ./platform/notifications/migrations

WORKDIR /app/platform/notifications
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3002/health || exit 1
CMD ["node", "src/server.js"]
