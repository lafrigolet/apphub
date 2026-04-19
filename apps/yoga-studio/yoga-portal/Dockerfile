# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/yoga-studio/yoga-portal/package.json ./apps/yoga-studio/yoga-portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @yoga-studio/yoga-portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/yoga-studio/yoga-portal ./apps/yoga-studio/yoga-portal

WORKDIR /app/apps/yoga-studio/yoga-portal

EXPOSE 5174
CMD ["pnpm", "dev", "--host"]

# ── Production ────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/yoga-studio/yoga-portal/package.json ./apps/yoga-studio/yoga-portal/package.json

RUN pnpm install --frozen-lockfile --prod --filter @yoga-studio/yoga-portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/yoga-studio/yoga-portal ./apps/yoga-studio/yoga-portal

WORKDIR /app/apps/yoga-studio/yoga-portal
RUN pnpm build
CMD ["pnpm", "preview", "--host"]
