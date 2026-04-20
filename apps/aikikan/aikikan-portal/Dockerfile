# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/aikikan/aikikan-portal/package.json ./apps/aikikan/aikikan-portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @aikikan/aikikan-portal...

COPY apps/aikikan/aikikan-portal ./apps/aikikan/aikikan-portal

WORKDIR /app/apps/aikikan/aikikan-portal

EXPOSE 5176
CMD ["pnpm", "dev", "--host"]

# ── Production ────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/aikikan/aikikan-portal/package.json ./apps/aikikan/aikikan-portal/package.json

RUN pnpm install --frozen-lockfile --prod --filter @aikikan/aikikan-portal...

COPY apps/aikikan/aikikan-portal ./apps/aikikan/aikikan-portal

WORKDIR /app/apps/aikikan/aikikan-portal
RUN pnpm build
CMD ["pnpm", "preview", "--host"]
