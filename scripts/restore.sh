#!/usr/bin/env bash
# Restores an orgtable PostgreSQL dump.
#
# Usage:   scripts/restore.sh <file.sql.gz>
# WARNING: replaces ALL current data in the database with the dump's contents.
# Before touching anything it takes an automatic backup in backups/pre-restore-<date>
# and stops the app while restoring. Attachments are not restored here (see
# docs/operations.md).
set -euo pipefail
umask 077

fail() {
  echo "✗ $*" >&2
  exit 1
}

ARG="${1:?Usage: scripts/restore.sh <file.sql.gz>}"
[ -f "$ARG" ] || fail "File not found: $ARG"
# Absolute path before moving to the repository root.
FILE="$(cd "$(dirname "$ARG")" && pwd)/$(basename "$ARG")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# The file is validated BEFORE asking for confirmation: a corrupt gzip or a truncated
# dump must never get as far as deleting anything.
gzip -t "$FILE" || fail "The file is not a valid gzip file: $FILE"
TAIL="$(gunzip -c "$FILE" | tail -n 10)"
case "$TAIL" in
  *"PostgreSQL database dump complete"*) ;;
  *) fail "The dump is incomplete (pg_dump's end marker is missing): $FILE" ;;
esac

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PGUSER="${POSTGRES_USER:-orgtable}"
PGDB="${POSTGRES_DB:-orgtable}"

printf 'This will OVERWRITE the database "%s". Continue? [y/N] ' "$PGDB"
read -r ans || ans=""
case "$ans" in
  y | Y) ;;
  *) echo "Cancelled."; exit 1 ;;
esac

PRE="backups/pre-restore-$(date +%Y%m%d-%H%M%S)"
echo "→ Safety backup in $PRE"
"$SCRIPT_DIR/backup.sh" "$PRE" || fail "Could not take the safety backup: the database was not touched."

# The app is stopped so nothing writes during the restore. It is only restarted if it
# was running; on start, the entrypoint applies any missing migrations if the dump comes
# from an older version.
APP_WAS_RUNNING=0
if [ -n "$(docker compose ps --status running -q app)" ]; then
  APP_WAS_RUNNING=1
  echo "→ Stopping the app"
  docker compose stop app
  trap 'echo "→ Starting the app"; docker compose start app' EXIT
fi

echo "→ Restoring $FILE"
# The public schema is emptied in the SAME transaction as the load: this also handles
# old dumps made without --clean, and if anything fails (ON_ERROR_STOP) nothing is
# committed and the database stays as it was. client_min_messages silences the NOTICEs
# from the cascading drop (one per table); errors are still shown.
{
  echo 'SET client_min_messages = warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  gunzip -c "$FILE"
} | docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 --single-transaction -q -U "$PGUSER" -d "$PGDB" > /dev/null \
  || fail "The restore failed and was rolled back. The safety backup is in $PRE."

echo "✓ Restore completed (safety backup in $PRE)"
if [ "$APP_WAS_RUNNING" = 0 ]; then
  echo "  The app was not running: start it with \"docker compose up -d\"."
fi
