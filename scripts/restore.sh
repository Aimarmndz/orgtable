#!/usr/bin/env bash
# Restaura un volcado de PostgreSQL de orgtable.
#
# Uso:   scripts/restore.sh <archivo.sql.gz>
# ¡ATENCIÓN! Sustituye TODOS los datos actuales de la base de datos por los del volcado.
# Antes de tocar nada hace una copia de seguridad automática en backups/pre-restore-<fecha>
# y para la app mientras restaura. Los adjuntos no se restauran aquí (ver
# docs/operations.md).
set -euo pipefail
umask 077

fail() {
  echo "✗ $*" >&2
  exit 1
}

ARG="${1:?Uso: scripts/restore.sh <archivo.sql.gz>}"
[ -f "$ARG" ] || fail "No existe el fichero: $ARG"
# Ruta absoluta antes de cambiar a la raíz del repositorio.
FILE="$(cd "$(dirname "$ARG")" && pwd)/$(basename "$ARG")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# Se valida el fichero ANTES de pedir confirmación: un gzip corrupto o un volcado
# truncado no debe llegar a borrar nada.
gzip -t "$FILE" || fail "El fichero no es un gzip válido: $FILE"
TAIL="$(gunzip -c "$FILE" | tail -n 10)"
case "$TAIL" in
  *"PostgreSQL database dump complete"*) ;;
  *) fail "El volcado está incompleto (falta la marca final de pg_dump): $FILE" ;;
esac

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PGUSER="${POSTGRES_USER:-orgtable}"
PGDB="${POSTGRES_DB:-orgtable}"

printf 'Esto SOBRESCRIBIRÁ la base de datos "%s". ¿Continuar? [y/N] ' "$PGDB"
read -r ans || ans=""
case "$ans" in
  y | Y) ;;
  *) echo "Cancelado."; exit 1 ;;
esac

PRE="backups/pre-restore-$(date +%Y%m%d-%H%M%S)"
echo "→ Copia previa de seguridad en $PRE"
"$SCRIPT_DIR/backup.sh" "$PRE" || fail "No se pudo hacer la copia previa: no se ha tocado la base de datos."

# La app se para para que nadie escriba durante la restauración. Solo se vuelve a
# arrancar si estaba en marcha; al arrancar, el entrypoint aplica las migraciones que
# falten si el volcado es de una versión anterior.
APP_WAS_RUNNING=0
if [ -n "$(docker compose ps --status running -q app)" ]; then
  APP_WAS_RUNNING=1
  echo "→ Parando la app"
  docker compose stop app
  trap 'echo "→ Arrancando la app"; docker compose start app' EXIT
fi

echo "→ Restaurando $FILE"
# Se vacía el esquema public en la MISMA transacción que la carga: así sirven también
# los volcados antiguos, hechos sin --clean, y si algo falla (ON_ERROR_STOP) no se
# confirma nada y la base de datos queda como estaba. client_min_messages calla los
# NOTICE del borrado en cascada (uno por tabla); los errores se siguen mostrando.
{
  echo 'SET client_min_messages = warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  gunzip -c "$FILE"
} | docker compose exec -T postgres \
  psql -v ON_ERROR_STOP=1 --single-transaction -q -U "$PGUSER" -d "$PGDB" > /dev/null \
  || fail "La restauración ha fallado y se ha deshecho. La copia previa está en $PRE."

echo "✓ Restauración completada (copia previa en $PRE)"
if [ "$APP_WAS_RUNNING" = 0 ]; then
  echo "  La app no estaba en marcha: arráncala con «docker compose up -d»."
fi
