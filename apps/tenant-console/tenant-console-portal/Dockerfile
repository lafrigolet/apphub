# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/tenant-console/tenant-console-portal/package.json ./apps/tenant-console/tenant-console-portal/

RUN pnpm install --no-frozen-lockfile --filter @tenant-console/tenant-console-portal

COPY apps/tenant-console/tenant-console-portal/ ./apps/tenant-console/tenant-console-portal/

WORKDIR /app/apps/tenant-console/tenant-console-portal
EXPOSE 5178
CMD ["pnpm", "dev"]

# ── Build ─────────────────────────────────────────────────────
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/tenant-console/tenant-console-portal/package.json ./apps/tenant-console/tenant-console-portal/

RUN pnpm install --frozen-lockfile --filter @tenant-console/tenant-console-portal

COPY apps/tenant-console/tenant-console-portal/ ./apps/tenant-console/tenant-console-portal/

RUN pnpm --filter @tenant-console/tenant-console-portal build

# ── Production ────────────────────────────────────────────────
FROM nginx:alpine AS production
COPY --from=build /app/apps/tenant-console/tenant-console-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost/_health || exit 1
