#!/usr/bin/env bash
# orgtable backup: dumps PostgreSQL and archives the attachments.
#
# Usage:   scripts/backup.sh [destination_dir]   (default: <repo>/backups)
# Can be run from any directory (e.g. from cron): it moves to the repository root so
# that `docker compose` finds docker-compose.yml and .env.
# Requires the postgres service to be running. See docs/operations.md.
#
# Exits non-zero (and leaves no half-written files) if anything fails: an empty or
# truncated backup announced as good is worse than none.
set -euo pipefail

# Dumps contain personal data (emails, password and token hashes, comments): only the
# owner may read them.
umask 077

fail() {
  echo "✗ $*" >&2
  exit 1
}

# The destination is made absolute BEFORE changing directory, so a relative path is
# resolved from where the script was launched. If it has to be created, umask already
# makes it 700; a pre-existing foreign one (e.g. /tmp) is left alone.
if [ -n "${1:-}" ]; then
  mkdir -p "$1"
  DIR="$(cd "$1" && pwd)"
fi
cd "$(dirname "$0")/.."
if [ -z "${DIR:-}" ]; then
  DIR="$PWD/backups"
  mkdir -p "$DIR"
  # The default directory only holds backups: lock it down even if it already existed
  # (umask does not change the permissions of an existing directory).
  chmod 700 "$DIR"
fi

# Load .env if present (for the database user and name).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PGUSER="${POSTGRES_USER:-orgtable}"
PGDB="${POSTGRES_DB:-orgtable}"

TS=$(date +%Y%m%d-%H%M%S)
DUMP="$DIR/orgtable-db-$TS.sql.gz"
UPLOADS="$DIR/orgtable-uploads-$TS.tar.gz"
# Write to .partial and only rename at the end if the checks pass: the destination never
# holds a file that looks like a good backup but is not.
DUMP_PART="$DUMP.partial"
UPLOADS_PART="$UPLOADS.partial"
trap 'rm -f "$DUMP_PART" "$UPLOADS_PART"' EXIT

echo "→ Dumping database to $DUMP"
# --clean --if-exists: the dump drops objects before creating them, so it can also be
# restored by hand over an already migrated database.
docker compose exec -T postgres pg_dump --clean --if-exists -U "$PGUSER" -d "$PGDB" \
  | gzip > "$DUMP_PART" \
  || fail "pg_dump failed: no database backup was created."

[ -s "$DUMP_PART" ] || fail "The database dump is empty."
gzip -t "$DUMP_PART" || fail "The database dump is not a valid gzip file."
# pg_dump writes this marker when it finishes; if it is missing, the dump is truncated.
# The last lines are read into a variable (not `| grep -q`) to avoid breaking the pipe
# with SIGPIPE under pipefail.
TAIL="$(gunzip -c "$DUMP_PART" | tail -n 10)"
case "$TAIL" in
  *"PostgreSQL database dump complete"*) ;;
  *) fail "The database dump is incomplete (pg_dump's end marker is missing)." ;;
esac
mv "$DUMP_PART" "$DUMP"

# Attachments live in the volume mounted at /data/uploads in the app container. If the
# app is running they are read from it; otherwise a throwaway container is started with
# the same volume. Exit code 3 means "no attachments directory", the only case skipped.
echo "→ Archiving attachments to $UPLOADS"
TAR_CMD='if [ -d /data/uploads ]; then tar czf - -C /data uploads; else exit 3; fi'
if [ -n "$(docker compose ps --status running -q app)" ]; then
  APP_RUN=(docker compose exec -T app sh -c "$TAR_CMD")
else
  APP_RUN=(docker compose run --rm --no-deps -T --entrypoint sh app -c "$TAR_CMD")
fi
set +e
"${APP_RUN[@]}" > "$UPLOADS_PART"
TAR_STATUS=$?
set -e
if [ "$TAR_STATUS" -eq 3 ]; then
  rm -f "$UPLOADS_PART"
  echo "  (/data/uploads does not exist in the container: no attachments to archive)"
elif [ "$TAR_STATUS" -ne 0 ]; then
  fail "Could not archive the attachments (exit code $TAR_STATUS). The database was backed up to $DUMP."
else
  gzip -t "$UPLOADS_PART" || fail "The attachments archive is not a valid gzip file. The database was backed up to $DUMP."
  mv "$UPLOADS_PART" "$UPLOADS"
  echo "  attachments archived"
fi

echo "✓ Backup completed in $DIR/"
