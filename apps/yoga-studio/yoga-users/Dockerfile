FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/yoga-studio/yoga-users/package.json ./apps/yoga-studio/yoga-users/package.json

RUN pnpm install --no-frozen-lockfile --filter @yoga-studio/yoga-users

COPY apps/yoga-studio/yoga-users/src ./apps/yoga-studio/yoga-users/src
COPY apps/yoga-studio/yoga-users/migrations ./apps/yoga-studio/yoga-users/migrations

WORKDIR /app/apps/yoga-studio/yoga-users
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/yoga-studio/yoga-users/package.json ./apps/yoga-studio/yoga-users/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @yoga-studio/yoga-users

COPY apps/yoga-studio/yoga-users/src ./apps/yoga-studio/yoga-users/src
COPY apps/yoga-studio/yoga-users/migrations ./apps/yoga-studio/yoga-users/migrations

WORKDIR /app/apps/yoga-studio/yoga-users
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3011
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3011/health || exit 1
CMD ["node", "src/server.js"]
