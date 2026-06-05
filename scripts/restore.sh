#!/usr/bin/env sh
set -eu

# Restaura un volcado de PostgreSQL de orgtable.
#
# Uso:   scripts/restore.sh <archivo.sql.gz>
# ¡ATENCIÓN! Sobrescribe los datos actuales de la base de datos. Ver docs/operations.md.

FILE="${1:?Uso: scripts/restore.sh <archivo.sql.gz>}"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
PGUSER="${POSTGRES_USER:-orgtable}"
PGDB="${POSTGRES_DB:-orgtable}"

printf 'Esto SOBRESCRIBIRÁ la base de datos "%s". ¿Continuar? [y/N] ' "$PGDB"
read -r ans
case "$ans" in
  y | Y) ;;
  *) echo "Cancelado."; exit 1 ;;
esac

echo "→ Restaurando $FILE"
gunzip -c "$FILE" | docker compose exec -T postgres psql -U "$PGUSER" -d "$PGDB"
echo "✓ Restauración completada"
