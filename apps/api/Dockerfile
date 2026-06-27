# ── Stage 1: install all deps ──────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json              ./apps/api/
COPY packages/shared/package.json       ./packages/shared/
RUN pnpm install --frozen-lockfile

# ── Stage 2: build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable pnpm
# OpenSSL is required by Prisma's engines (schema + query) on Alpine/musl.
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules                  ./node_modules
COPY --from=deps /app/apps/api/node_modules         ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules  ./packages/shared/node_modules
COPY . .
RUN pnpm --filter @abaya-shop/shared build
RUN pnpm --filter @abaya-shop/api exec prisma generate
RUN pnpm --filter @abaya-shop/api build

# ── Stage 3: slim production runtime ───────────────────────────────────────
FROM node:20-alpine AS runner
RUN corepack enable pnpm
# OpenSSL is required at runtime by Prisma's schema engine (db push) and query engine.
RUN apk add --no-cache openssl
WORKDIR /app

# Install only production deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json              ./apps/api/
COPY packages/shared/package.json       ./packages/shared/
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts and Prisma schema/migrations
COPY --from=builder /app/apps/api/dist          ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules  ./apps/api/node_modules
COPY --from=builder /app/packages/shared/dist   ./packages/shared/dist
COPY apps/api/prisma                             ./apps/api/prisma
# `prisma/seed.ts` imports from `../src/...`; the entrypoint runs it via tsx, so
# the TS sources must be present in the runtime image or seeding fails silently.
COPY --from=builder /app/apps/api/src           ./apps/api/src

COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["./apps/api/docker-entrypoint.sh"]
