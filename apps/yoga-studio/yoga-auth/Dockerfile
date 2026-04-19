FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/yoga-studio/yoga-auth/package.json ./apps/yoga-studio/yoga-auth/package.json

RUN pnpm install --no-frozen-lockfile --filter @yoga-studio/yoga-auth

COPY apps/yoga-studio/yoga-auth/src ./apps/yoga-studio/yoga-auth/src
COPY apps/yoga-studio/yoga-auth/migrations ./apps/yoga-studio/yoga-auth/migrations

WORKDIR /app/apps/yoga-studio/yoga-auth
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/yoga-studio/yoga-auth/package.json ./apps/yoga-studio/yoga-auth/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @yoga-studio/yoga-auth

COPY apps/yoga-studio/yoga-auth/src ./apps/yoga-studio/yoga-auth/src
COPY apps/yoga-studio/yoga-auth/migrations ./apps/yoga-studio/yoga-auth/migrations

WORKDIR /app/apps/yoga-studio/yoga-auth
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3010/health || exit 1
CMD ["node", "src/server.js"]
