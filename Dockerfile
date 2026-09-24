# syntax=docker/dockerfile:1

# orgtable — imagen de producción multi-stage. Ver docs/docker.md.
# Se construye localmente en el servidor del usuario (docker compose build).

# --- Base con pnpm -------------------------------------------------------------
# pnpm llega por Corepack, fijado a la versión de `packageManager` en package.json,
# para que la imagen instale con el mismo gestor y versión que el lockfile.
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# --- Stage 1: deps -----------------------------------------------------------
# Instala dependencias en Alpine para que los engines nativos de Prisma (el
# schema-engine de Migrate) se descarguen para linux-musl, no para glibc.
# pnpm-workspace.yaml lleva la lista `allowBuilds`: sin ella pnpm no ejecuta los
# scripts de instalación de Prisma y faltaría el schema-engine.
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Stage 2: builder --------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL ficticia: prisma.config.ts exige resolver esta variable al cargar la
# config (Prisma 7 lanza error si falta), pero ni `generate` ni el build conectan a
# la BD —las páginas son dinámicas (auth) y no la consultan en build—.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
# Genera el Prisma Client (query engine WASM, sin binario).
RUN pnpm exec prisma generate
RUN pnpm build

# --- Stage 3: runner ---------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Directorio de adjuntos. En producción es un volumen montado (ver docker-compose.yml);
# se crea aquí y se cede al usuario sin privilegios para que pueda escribir.
ENV ORGTABLE_UPLOAD_DIR=/data/uploads

# openssl: requerido por el schema-engine de Prisma para `migrate deploy`.
RUN apk add --no-cache openssl

# Usuario sin privilegios.
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

# Directorio de adjuntos escribible por el usuario (lo monta un volumen en producción).
RUN mkdir -p /data/uploads && chown -R nextjs:nodejs /data

# Aplicación Next.js standalone (servidor Node mínimo + assets).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# node_modules completo: el CLI de Prisma (`migrate deploy` en el entrypoint) necesita
# sus dependencias transitivas (p. ej. `effect`, que usa @prisma/config) y el cliente
# generado. El trazado de `output: standalone` solo incluye lo que importa la app, no
# el CLI, así que copiamos el árbol completo. (Optimizable a futuro con un stage
# prod-deps; ver docs/docker.md.)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
