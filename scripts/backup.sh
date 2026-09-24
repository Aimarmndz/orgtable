#!/usr/bin/env bash
# Copia de seguridad de orgtable: vuelca PostgreSQL y archiva los adjuntos.
#
# Uso:   scripts/backup.sh [directorio_destino]   (por defecto: <repo>/backups)
# Se puede lanzar desde cualquier directorio (p. ej. desde cron): se sitúa en la raíz del
# repositorio para que `docker compose` encuentre el docker-compose.yml y el .env.
# Requiere que el servicio postgres esté en marcha. Ver docs/operations.md.
#
# Sale con código distinto de 0 (y sin dejar ficheros a medias) si algo falla: una copia
# vacía o truncada que se anuncia como buena es peor que ninguna.
set -euo pipefail

# Los volcados contienen datos personales (emails, hashes de contraseñas y de tokens,
# comentarios): solo el propietario puede leerlos.
umask 077

fail() {
  echo "✗ $*" >&2
  exit 1
}

# El destino se resuelve a ruta absoluta ANTES de cambiar de directorio, para que una
# ruta relativa se interprete desde donde se lanzó el script. Si hay que crearlo, umask
# ya lo deja en 700; uno ajeno que ya existía (p. ej. /tmp) no se toca.
if [ -n "${1:-}" ]; then
  mkdir -p "$1"
  DIR="$(cd "$1" && pwd)"
fi
cd "$(dirname "$0")/.."
if [ -z "${DIR:-}" ]; then
  DIR="$PWD/backups"
  mkdir -p "$DIR"
  # El directorio por defecto es solo de las copias: se cierra aunque ya existiera
  # (umask no cambia los permisos de un directorio existente).
  chmod 700 "$DIR"
fi

# Carga las variables del .env si existe (para el usuario y la base de datos).
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
# Se escribe en .partial y solo se renombra al final si pasa las comprobaciones: así
# nunca queda en el destino un fichero con aspecto de copia buena que no lo es.
DUMP_PART="$DUMP.partial"
UPLOADS_PART="$UPLOADS.partial"
trap 'rm -f "$DUMP_PART" "$UPLOADS_PART"' EXIT

echo "→ Volcando base de datos a $DUMP"
# --clean --if-exists: el volcado borra los objetos antes de crearlos, así que también
# sirve para restaurar a mano sobre una base de datos ya migrada.
docker compose exec -T postgres pg_dump --clean --if-exists -U "$PGUSER" -d "$PGDB" \
  | gzip > "$DUMP_PART" \
  || fail "pg_dump ha fallado: no se ha generado la copia de la base de datos."

[ -s "$DUMP_PART" ] || fail "El volcado de la base de datos está vacío."
gzip -t "$DUMP_PART" || fail "El volcado de la base de datos no es un gzip válido."
# pg_dump escribe esta marca al terminar; si falta, el volcado está truncado. Se leen las
# últimas líneas a una variable (y no con `| grep -q`) para no romper la tubería con
# SIGPIPE bajo pipefail.
TAIL="$(gunzip -c "$DUMP_PART" | tail -n 10)"
case "$TAIL" in
  *"PostgreSQL database dump complete"*) ;;
  *) fail "El volcado de la base de datos está incompleto (falta la marca final de pg_dump)." ;;
esac
mv "$DUMP_PART" "$DUMP"

# Adjuntos: viven en el volumen montado en /data/uploads del contenedor app. Si la app
# está en marcha se lee desde ella; si no, se arranca un contenedor efímero con el mismo
# volumen. El código 3 significa «no hay directorio de adjuntos», lo único que se omite.
echo "→ Archivando adjuntos a $UPLOADS"
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
  echo "  (no existe /data/uploads en el contenedor: no hay adjuntos que archivar)"
elif [ "$TAR_STATUS" -ne 0 ]; then
  fail "No se pudieron archivar los adjuntos (código $TAR_STATUS). La base de datos sí se copió en $DUMP."
else
  gzip -t "$UPLOADS_PART" || fail "El archivo de adjuntos no es un gzip válido. La base de datos sí se copió en $DUMP."
  mv "$UPLOADS_PART" "$UPLOADS"
  echo "  adjuntos archivados"
fi

echo "✓ Backup completado en $DIR/"
