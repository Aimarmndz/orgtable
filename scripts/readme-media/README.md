# Capturas y GIF del README

Scripts para regenerar `docs/screenshots/` con la app real y datos de ejemplo. No forman
parte de la app ni de la CI. El porqué está en
[`docs/DECISIONES.md`](../../docs/DECISIONES.md) («README visual con capturas y GIF reales»).

Necesitan Docker con el Postgres de desarrollo, Node 22, Python 3 con Pillow y
`playwright-core`, que se instala aparte para no añadirlo a las dependencias del proyecto.

```bash
# 1. BD de demo aparte (nunca la de desarrollo: seed-demo.mjs la vacía)
docker exec orgtable-dev-pg psql -U orgtable -d postgres -c "CREATE DATABASE orgtable_demo"
DEMO_URL="postgresql://orgtable:<contraseña>@localhost:5433/orgtable_demo"
DATABASE_URL="$DEMO_URL" pnpm exec prisma migrate deploy
export DEMO_PASSWORD="$(openssl rand -hex 12)"
DATABASE_URL="$DEMO_URL" node scripts/readme-media/seed-demo.mjs

# 2. Build de producción servido con la BD de demo (puerto libre, p. ej. 3051)
pnpm build
DATABASE_URL="$DEMO_URL" pnpm start -p 3051 &

# 3. Capturas y fotogramas. playwright-core va en una carpeta temporal y el script se
#    copia allí: los import de ESM se resuelven desde la carpeta del script.
mkdir -p /tmp/orgtable-media && npm i --prefix /tmp/orgtable-media playwright-core
cp scripts/readme-media/capture.mjs /tmp/orgtable-media/
OUT=/tmp/orgtable-media node /tmp/orgtable-media/capture.mjs
OUT=/tmp/orgtable-media python3 scripts/readme-media/make_gifs.py
```

`capture.mjs` usa el Chromium que instala Playwright o el que indiques en `CHROME`.
`make_gifs.py` deja en `$OUT/gifs/` los dos GIF y las capturas en WebP: cópialos a
`docs/screenshots/` con `cp /tmp/orgtable-media/gifs/*.{gif,webp} docs/screenshots/`. Al regrabar, la demo cambia (se mueven tarjetas): vuelve a sembrarla
antes de repetir.
