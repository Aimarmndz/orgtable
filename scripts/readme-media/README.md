# README screenshots and GIFs

Scripts to regenerate `docs/screenshots/` from the real app with sample data. They are not
part of the app or the CI. The reasoning is in
[`docs/DECISIONES.md`](../../docs/DECISIONES.md) (the entry about the README screenshots
and GIFs).

They need Docker with the development Postgres, Node 22, Python 3 with Pillow, and
`playwright-core`, which is installed separately so it is not added to the project's
dependencies.

```bash
# 1. Separate demo database (never the development one: seed-demo.mjs empties it)
docker exec orgtable-dev-pg psql -U orgtable -d postgres -c "CREATE DATABASE orgtable_demo"
DEMO_URL="postgresql://orgtable:<password>@localhost:5433/orgtable_demo"
DATABASE_URL="$DEMO_URL" pnpm exec prisma migrate deploy
export DEMO_PASSWORD="$(openssl rand -hex 12)"
DATABASE_URL="$DEMO_URL" node scripts/readme-media/seed-demo.mjs

# 2. Production build served with the demo database (any free port, e.g. 3051)
pnpm build
DATABASE_URL="$DEMO_URL" pnpm start -p 3051 &

# 3. Screenshots and frames. playwright-core goes in a temporary folder and the script is
#    copied there: ESM imports are resolved from the script's folder.
mkdir -p /tmp/orgtable-media && npm i --prefix /tmp/orgtable-media playwright-core
cp scripts/readme-media/capture.mjs /tmp/orgtable-media/
OUT=/tmp/orgtable-media node /tmp/orgtable-media/capture.mjs
OUT=/tmp/orgtable-media python3 scripts/readme-media/make_gifs.py
```

`capture.mjs` uses the Chromium installed by Playwright, or the one set in `CHROME`.
`make_gifs.py` writes the two GIFs and the WebP screenshots to `$OUT/gifs/`: copy them to
`docs/screenshots/` with `cp /tmp/orgtable-media/gifs/*.{gif,webp} docs/screenshots/`.
Recording changes the demo (cards are moved): seed it again before repeating.
