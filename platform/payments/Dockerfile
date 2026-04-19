FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/payments/package.json ./platform/payments/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/platform-payments...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/payments/src ./platform/payments/src
COPY platform/payments/migrations ./platform/payments/migrations

WORKDIR /app/platform/payments
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json ./packages/platform-sdk/package.json
COPY platform/payments/package.json ./platform/payments/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/platform-payments...

COPY packages/platform-sdk ./packages/platform-sdk
COPY platform/payments/src ./platform/payments/src
COPY platform/payments/migrations ./platform/payments/migrations

WORKDIR /app/platform/payments
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "src/server.js"]
