#!/usr/bin/env bash
# Actualiza orgtable a la última versión y la relanza.
#
# La imagen se construye localmente (no se publica en un registro), así que el flujo es
# "copia de seguridad + traer cambios + reconstruir". Las migraciones de base de datos se
# aplican SOLAS al arrancar (docker-entrypoint.sh ejecuta `prisma migrate deploy`), por
# eso la copia se hace antes: si una migración sale mal, hay desde dónde volver. Un
# `docker compose up -d --build` lanzado a mano NO pasa por aquí ni hace esa copia.
# Ver docs/operations.md.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Asegurando que PostgreSQL está en marcha para la copia previa"
docker compose up -d --wait postgres

echo "→ Copia de seguridad previa a la actualización"
# Con set -e, si la copia falla la actualización se aborta sin tocar nada.
scripts/backup.sh

echo "→ Trayendo cambios (git pull)"
git pull --ff-only

echo "→ Reconstruyendo e iniciando los contenedores"
docker compose up -d --build

echo "✓ orgtable actualizado. Las migraciones pendientes se aplican en el arranque."
