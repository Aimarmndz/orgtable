# syntax=docker/dockerfile:1

# orgtable — multi-stage production image. See docs/docker.md.
# Built locally on the user's server (docker compose build).

# --- Base with pnpm ------------------------------------------------------------
# pnpm comes from Corepack, pinned to the `packageManager` version in package.json,
# so the image installs with the same package manager and version as the lockfile.
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# --- Stage 1: deps -----------------------------------------------------------
# Install dependencies on Alpine so Prisma's native engines (Migrate's schema-engine)
# are downloaded for linux-musl, not glibc.
# pnpm-workspace.yaml holds the `allowBuilds` list: without it pnpm does not run
# Prisma's install scripts and the schema-engine would be missing.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Stage 2: builder --------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Dummy DATABASE_URL: prisma.config.ts must resolve this variable when loading the
# config (Prisma 7 throws if it is missing), but neither `generate` nor the build
# connect to the database (pages are dynamic because of auth and do not query it at
# build time).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
# Generate the Prisma Client (WASM query engine, no binary).
RUN pnpm exec prisma generate
RUN pnpm build

# --- Stage 3: runner ---------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Attachments directory. In production it is a mounted volume (see docker-compose.yml);
# it is created here and handed to the unprivileged user so it can write to it.
ENV ORGTABLE_UPLOAD_DIR=/data/uploads

# openssl: required by Prisma's schema-engine for `migrate deploy`.
RUN apk add --no-cache openssl

# Unprivileged user.
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

# Attachments directory writable by that user (a volume is mounted here in production).
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

# Standalone Next.js app (minimal Node server + assets).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Full node_modules: the Prisma CLI (`migrate deploy` in the entrypoint) needs its
# transitive dependencies (e.g. `effect`, used by @prisma/config) and the generated
# client. `output: standalone` tracing only includes what the app imports, not the CLI,
# so the whole tree is copied. (Could be slimmed down later with a prod-deps stage; see
# docs/docker.md.)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json

COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# The code stays owned by root and read-only for `nextjs`: a bug in the app cannot
# rewrite server.js, .next or node_modules. A `chown -R /app` would also duplicate
# node_modules in another layer of hundreds of MB. Only Next's cache needs to be writable.
RUN mkdir -p .next/cache && chown nextjs:nodejs .next/cache

USER nextjs
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
