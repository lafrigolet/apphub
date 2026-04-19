FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/yoga-studio/yoga-classes/package.json ./apps/yoga-studio/yoga-classes/package.json

RUN pnpm install --no-frozen-lockfile --filter @yoga-studio/yoga-classes

COPY apps/yoga-studio/yoga-classes/src ./apps/yoga-studio/yoga-classes/src
COPY apps/yoga-studio/yoga-classes/migrations ./apps/yoga-studio/yoga-classes/migrations

WORKDIR /app/apps/yoga-studio/yoga-classes
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/yoga-studio/yoga-classes/package.json ./apps/yoga-studio/yoga-classes/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @yoga-studio/yoga-classes

COPY apps/yoga-studio/yoga-classes/src ./apps/yoga-studio/yoga-classes/src
COPY apps/yoga-studio/yoga-classes/migrations ./apps/yoga-studio/yoga-classes/migrations

WORKDIR /app/apps/yoga-studio/yoga-classes
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3012
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3012/health || exit 1
CMD ["node", "src/server.js"]
