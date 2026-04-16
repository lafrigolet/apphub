# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install
COPY . .
# Expose Vite's default port and allow access from Docker network
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]

# ── Production ────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod
COPY . .
RUN pnpm build
# Production serving is usually done via Nginx or similar,
# but for simplicity, we'll keep the build artifact here.
CMD ["pnpm", "preview", "--host"]
