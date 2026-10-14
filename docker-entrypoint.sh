#!/bin/sh
# Entrypoint of the `app` container. Applies pending Prisma migrations (idempotent:
# `migrate deploy` only runs the missing ones) and then starts the Next.js server.
# See docs/docker.md.
set -e

echo "[orgtable] Applying database migrations..."
# Call the CLI by its direct path (not `npx`) so we do not depend on .bin symlinks.
node node_modules/prisma/build/index.js migrate deploy

echo "[orgtable] Starting the server..."
exec "$@"
