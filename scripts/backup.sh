#!/usr/bin/env sh
set -eu

# Copia de seguridad de orgtable: vuelca PostgreSQL y archiva los adjuntos.
#
# Uso:   scripts/backup.sh [directorio_destino]   (por defecto: ./backups)
# Lee POSTGRES_USER / POSTGRES_DB del .env. Requiere que docker compose esté en marcha.
# Ver docs/operations.md.

DIR="${1:-backups}"
mkdir -p "$DIR"

# Carga las variables del .env si existe (para el usuario y la base de datos).
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
PGUSER="${POSTGRES_USER:-orgtable}"
PGDB="${POSTGRES_DB:-orgtable}"

TS=$(date +%Y%m%d-%H%M%S)
DUMP="$DIR/orgtable-db-$TS.sql.gz"

echo "→ Volcando base de datos a $DUMP"
docker compose exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" | gzip > "$DUMP"

# Adjuntos: viven en el volumen montado en /data/uploads del contenedor app.
UPLOADS="$DIR/orgtable-uploads-$TS.tar.gz"
echo "→ Archivando adjuntos a $UPLOADS"
if docker compose exec -T app sh -c 'cd /data && tar czf - uploads' > "$UPLOADS" 2>/dev/null; then
  echo "  adjuntos archivados"
else
  rm -f "$UPLOADS"
  echo "  (sin adjuntos o contenedor app no disponible: se omite)"
fi

echo "✓ Backup completado en $DIR/"
