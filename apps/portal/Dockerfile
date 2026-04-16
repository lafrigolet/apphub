# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy packages required by portal
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/portal/package.json ./apps/portal/package.json

# Install dependencies for portal and its workspace deps
RUN pnpm install --no-frozen-lockfile --filter @splitpay/portal...

# Copy source
COPY packages/eslint-config ./packages/eslint-config
COPY apps/portal ./apps/portal

WORKDIR /app/apps/portal

# Expose Vite's default port and allow access from Docker network
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]

# ── Production ────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy packages required by portal
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/portal/package.json ./apps/portal/package.json

# Install dependencies for portal and its workspace deps
RUN pnpm install --frozen-lockfile --prod --filter @splitpay/portal...

# Copy source
COPY packages/eslint-config ./packages/eslint-config
COPY apps/portal ./apps/portal

WORKDIR /app/apps/portal
RUN pnpm build
CMD ["pnpm", "preview", "--host"]
