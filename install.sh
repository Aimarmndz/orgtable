#!/usr/bin/env bash
# orgtable — self-hosted installer.
#
#   curl -sSL https://raw.githubusercontent.com/<owner>/orgtable/main/install.sh | bash
#
# Installs Docker if missing, clones/updates the repository, generates a .env with
# random secrets and starts the app (local build). See docs/installation.md.
set -euo pipefail

INSTALL_DIR="${ORGTABLE_DIR:-$HOME/orgtable}"
REPO_URL="${ORGTABLE_REPO:-https://github.com/Aimarmndz/orgtable.git}"

log() { printf '\033[1;36m[orgtable]\033[0m %s\n' "$1"; }

# 1. Docker -------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Docker is not installed. Installing it with get.docker.com..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 (docker compose) is required. Install it and try again." >&2
  exit 1
fi

# 2. Source code (the local build needs the full repo) ------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation in $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Cloning orgtable into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# 3. .env with random secrets (idempotent: never overwritten if it exists) ----
if [ ! -f .env ]; then
  log "Generating .env with random secrets..."
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  CRON_SECRET="$(openssl rand -hex 32)"
  cat > .env <<EOF
POSTGRES_USER=orgtable
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=orgtable
DATABASE_URL=postgresql://orgtable:${POSTGRES_PASSWORD}@postgres:5432/orgtable
SESSION_SECRET=${SESSION_SECRET}
CRON_SECRET=${CRON_SECRET}
APP_PORT=3000
EOF
  chmod 600 .env
else
  log ".env already exists: keeping the current secrets."
  # Older installations had no CRON_SECRET: add it without touching anything else, so
  # due-date reminders can be scheduled (docs/reminders.md).
  if ! grep -q '^CRON_SECRET=.' .env; then
    log "Adding CRON_SECRET to .env..."
    # If .env does not end with a newline, the variable would be glued to the last line.
    if [ -n "$(tail -c 1 .env)" ]; then echo >> .env; fi
    printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
  fi
fi

# 4. Build and start ------------------------------------------------------------
log "Building the image (this can take a few minutes the first time)..."
docker compose build

log "Starting the services..."
docker compose up -d

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
APP_PORT="$(grep '^APP_PORT=' .env | cut -d= -f2 || true)"
APP_PORT="${APP_PORT:-3000}"
PORT="${APP_PORT##*:}"
# APP_PORT may be prefixed with an IP ("127.0.0.1:3000", see docs/self-hosting.md). If it
# is a loopback address, the app cannot be reached via the server's IP: explain how to
# reach it instead.
case "$APP_PORT" in
  127.*:* | localhost:* | \[::1\]:*)
    log "Done! The app only listens on ${APP_PORT} (local). Complete the initial setup wizard"
    log "through your reverse proxy or with an SSH tunnel from your machine:"
    log "  ssh -L ${PORT}:${APP_PORT} <user>@<server>   and open http://localhost:${PORT}"
    ;;
  *)
    HOST="${IP:-<server-IP>}"
    # With a specific IP (other than 0.0.0.0, all interfaces), the app only listens there.
    case "$APP_PORT" in 0.0.0.0:*) ;; *:*) HOST="${APP_PORT%:*}" ;; esac
    log "Done! Open http://${HOST}:${PORT} and complete the initial setup wizard."
    ;;
esac
log "Warning: over plain HTTP the password and session travel unencrypted. For real use, put"
log "a reverse proxy with HTTPS in front: docs/self-hosting.md, section \"HTTPS and domain\"."
