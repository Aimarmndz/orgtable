#!/usr/bin/env bash
# orgtable — instalador self-hosted.
#
#   curl -sSL https://raw.githubusercontent.com/<owner>/orgtable/main/install.sh | bash
#
# Instala Docker si falta, clona/actualiza el repositorio, genera un .env con
# secretos aleatorios y levanta la app (build local). Ver docs/installation.md.
set -euo pipefail

INSTALL_DIR="${ORGTABLE_DIR:-$HOME/orgtable}"
REPO_URL="${ORGTABLE_REPO:-https://github.com/Aimarmndz/orgtable.git}"

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
  log ".env ya existe: se conservan los secretos actuales."
  # Las instalaciones anteriores no tenían CRON_SECRET: se añade sin tocar lo demás, para
  # que los recordatorios de vencimiento se puedan programar (docs/reminders.md).
  if ! grep -q '^CRON_SECRET=.' .env; then
    log "Añadiendo CRON_SECRET al .env..."
    # Si el .env no acaba en salto de línea, la variable se pegaría a la última línea.
    if [ -n "$(tail -c 1 .env)" ]; then echo >> .env; fi
    printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
  fi
fi

# 4. Construir y levantar -----------------------------------------------------
log "Construyendo la imagen (esto puede tardar unos minutos la primera vez)..."
docker compose build

log "Levantando los servicios..."
docker compose up -d

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
APP_PORT="$(grep '^APP_PORT=' .env | cut -d= -f2 || true)"
APP_PORT="${APP_PORT:-3000}"
PORT="${APP_PORT##*:}"
# APP_PORT puede llevar una IP delante («127.0.0.1:3000», ver docs/self-hosting.md). Si es
# de loopback, la app no es accesible por la IP del servidor: se dice cómo llegar a ella.
case "$APP_PORT" in
  127.*:* | localhost:* | \[::1\]:*)
    log "¡Listo! La app solo escucha en ${APP_PORT} (local). Completa el asistente de configuración"
    log "inicial a través de tu proxy inverso o con un túnel SSH desde tu equipo:"
    log "  ssh -L ${PORT}:${APP_PORT} <usuario>@<servidor>   y abre http://localhost:${PORT}"
    ;;
  *)
    HOST="${IP:-<IP-del-servidor>}"
    # Con una IP concreta (que no sea 0.0.0.0, todas las interfaces), la app solo escucha ahí.
    case "$APP_PORT" in 0.0.0.0:*) ;; *:*) HOST="${APP_PORT%:*}" ;; esac
    log "¡Listo! Abre http://${HOST}:${PORT} y completa el asistente de configuración inicial."
    ;;
esac
log "Aviso: por HTTP la contraseña y la sesión viajan sin cifrar. Para uso real, pon delante"
log "un proxy inverso con HTTPS: docs/self-hosting.md, apartado «HTTPS y dominio»."
