#!/usr/bin/env sh
set -eu

# Actualiza orgtable a la última versión y la relanza.
#
# La imagen se construye localmente (no se publica en un registro), así que el flujo es
# "traer cambios + reconstruir". Las migraciones de base de datos se aplican SOLAS al
# arrancar (docker-entrypoint.sh ejecuta `prisma migrate deploy`). Ver docs/operations.md.
#
# Recomendado: ejecuta scripts/backup.sh antes de actualizar.

echo "→ Trayendo cambios (git pull)"
git pull --ff-only

echo "→ Reconstruyendo e iniciando los contenedores"
docker compose up -d --build

echo "✓ orgtable actualizado. Las migraciones pendientes se aplican en el arranque."
