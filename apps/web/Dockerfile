# ── Stage 1: build Vite app ────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json         ./apps/web/
COPY packages/shared/package.json  ./packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

# VITE_* values are baked into the JS bundle at build time
ARG VITE_API_URL=http://localhost:3001/api
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_SOCKET_URL=http://localhost:3001
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

RUN pnpm --filter @abaya-shop/shared build
RUN pnpm --filter @abaya-shop/web build

# ── Stage 2: serve with nginx ──────────────────────────────────────────────
FROM nginx:stable-alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
