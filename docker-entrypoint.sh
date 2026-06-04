#!/bin/sh
# Entrypoint del contenedor `app`. Aplica las migraciones pendientes de Prisma
# (idempotente: `migrate deploy` solo ejecuta las que faltan) y luego arranca el
# servidor Next.js. Ver docs/docker.md.
set -e

echo "[orgtable] Aplicando migraciones de la base de datos..."
# Invocamos el CLI por ruta directa (no `npx`) para no depender de symlinks de .bin.
node node_modules/prisma/build/index.js migrate deploy

echo "[orgtable] Arrancando el servidor..."
exec "$@"
