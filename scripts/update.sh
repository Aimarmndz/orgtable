#!/usr/bin/env bash
# Updates orgtable to the latest version and restarts it.
#
# The image is built locally (it is not published to a registry), so the flow is
# "backup + pull changes + rebuild". Database migrations are applied AUTOMATICALLY on
# start (docker-entrypoint.sh runs `prisma migrate deploy`), which is why the backup
# comes first: if a migration goes wrong, there is something to roll back to. A manual
# `docker compose up -d --build` does NOT go through here and takes no backup.
# See docs/operations.md.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Making sure PostgreSQL is running for the pre-update backup"
docker compose up -d --wait postgres

echo "→ Pre-update backup"
# With set -e, if the backup fails the update aborts without touching anything.
scripts/backup.sh

echo "→ Pulling changes (git pull)"
git pull --ff-only

echo "→ Rebuilding and starting the containers"
docker compose up -d --build

echo "✓ orgtable updated. Pending migrations are applied on start."
