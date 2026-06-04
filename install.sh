#!/usr/bin/env bash
# orgtable — instalador self-hosted.
#
#   curl -sSL https://raw.githubusercontent.com/<owner>/orgtable/main/install.sh | bash
#
# Instala Docker si falta, clona/actualiza el repositorio, genera un .env con
# secretos aleatorios y levanta la app (build local). Ver docs/installation.md.
set -euo pipefail

INSTALL_DIR="${ORGTABLE_DIR:-$HOME/orgtable}"
REPO_URL="${ORGTABLE_REPO:-https://github.com/aimarmndzz/orgtable.git}"

log() { printf '\033[1;36m[orgtable]\033[0m %s\n' "$1"; }

# 1. Docker -------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Docker no está instalado. Instalándolo con get.docker.com..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: se necesita Docker Compose v2 (docker compose). Instálalo y reintenta." >&2
  exit 1
fi

# 2. Código fuente (build local necesita el repo completo) --------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Actualizando instalación existente en $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Clonando orgtable en $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# 3. .env con secretos aleatorios (idempotente: no sobrescribe si ya existe) ---
if [ ! -f .env ]; then
  log "Generando .env con secretos aleatorios..."
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  cat > .env <<EOF
POSTGRES_USER=orgtable
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=orgtable
DATABASE_URL=postgresql://orgtable:${POSTGRES_PASSWORD}@postgres:5432/orgtable
SESSION_SECRET=${SESSION_SECRET}
APP_PORT=3000
EOF
  chmod 600 .env
else
  log ".env ya existe: se conservan los secretos actuales."
fi

# 4. Construir y levantar -----------------------------------------------------
log "Construyendo la imagen (esto puede tardar unos minutos la primera vez)..."
docker compose build

log "Levantando los servicios..."
docker compose up -d

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
APP_PORT="$(grep '^APP_PORT=' .env | cut -d= -f2)"
log "¡Listo! Abre http://${IP:-<IP-del-servidor>}:${APP_PORT:-3000} y completa el asistente de configuración inicial."
