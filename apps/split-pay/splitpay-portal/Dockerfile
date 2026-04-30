# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/split-pay/splitpay-portal/package.json ./apps/split-pay/splitpay-portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @split-pay/splitpay-portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/split-pay/splitpay-portal ./apps/split-pay/splitpay-portal

WORKDIR /app/apps/split-pay/splitpay-portal
EXPOSE 5175
CMD ["pnpm", "dev", "--host"]

# ── Build ─────────────────────────────────────────────────────
# Vite inlines VITE_* env vars at build time. Pass them via --build-arg
# (or leave defaults so paths resolve relatively from the same subdomain).
# NODE_ENV is left unset so pnpm installs devDeps (vite); the runtime
# image (nginx-alpine) does not run Node at all.
FROM base AS build
ARG VITE_APP_ID=split-pay
ARG VITE_API_BASE_URL=
ENV VITE_APP_ID=${VITE_APP_ID}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/split-pay/splitpay-portal/package.json ./apps/split-pay/splitpay-portal/package.json

RUN pnpm install --frozen-lockfile --filter @split-pay/splitpay-portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/split-pay/splitpay-portal ./apps/split-pay/splitpay-portal

RUN pnpm --filter @split-pay/splitpay-portal build

# ── Production ────────────────────────────────────────────────
FROM nginx:alpine AS production
COPY --from=build /app/apps/split-pay/splitpay-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost/_health || exit 1
