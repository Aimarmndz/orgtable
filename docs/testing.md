# Tests e integración continua

orgtable tiene tests unitarios con **Vitest** y un workflow de **GitHub Actions** que se
ejecuta en cada push a `main` y en cada pull request.

Hay dos niveles: **tests unitarios** (sin BD ni red) y **tests de integración** (rutas de
la API, Server Actions y servicios contra una PostgreSQL real).

## Ejecutar en local

```bash
pnpm test           # unitarios (rápidos, sin BD)
pnpm test:watch # unitarios en modo watch
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint

# Integración: requiere una BD de test (su nombre DEBE acabar en `_test`).
# Crea orgtable_test en tu Postgres de dev y aplícale las migraciones una vez:
createdb -h localhost -p 5433 -U orgtable orgtable_test   # o vía docker exec psql
DATABASE_URL='postgresql://orgtable:PASS@localhost:5433/orgtable_test' pnpm exec prisma migrate deploy
# y luego:
DATABASE_URL='postgresql://orgtable:PASS@localhost:5433/orgtable_test' pnpm test:integration
```

## Qué cubre cada archivo

El inventario completo es `ls test/*.test.ts test/integration/*.int.test.ts`. Las tablas
agrupan los archivos por área para saber dónde mirar o dónde añadir un test; el detalle
de cada caso está en los `describe`/`it` del propio archivo, así que aquí no se repite.
Un archivo nuevo se añade a la fila de su área.

### Tests unitarios

Están en `test/` y no usan base de datos ni red. No todos son lógica pura:
`ops-scripts.test.ts` lanza los scripts de `scripts/` e `install.sh` con bash y un
`docker` falso en el `PATH`, `storage.test.ts` escribe en un directorio temporal y los de
interfaz renderizan componentes con `react-dom/server` (no hay jsdom).

| Área | Archivos (`test/<nombre>.test.ts`) |
|------|----------|
| Autorización, sesión y seguridad | `roles`, `tokens`, `auth`, `client-ip`, `rate-limit`, `csp`, `next-config` |
| Validación y datos | `validators`, `ordering`, `colors`, `search-params`, `format-date` |
| Tablero y tarjetas (lógica de cliente) | `board-filters`, `board-collision`, `optimistic`, `card-modal-helpers` |
| Tiempo real | `realtime-bus` (puente `LISTEN/NOTIFY` con un `pg` falso), `realtime-reconnect` |
| Interfaz y accesibilidad | `card-item`, `admin-forms-a11y`, `delete-board-button`, `delete-board-button-focus`, `metadata`, `contrast` (lee `app/globals.css`) |
| Operación | `ops-scripts`, `storage` |

### Tests de integración

Ejercen el código **contra una PostgreSQL real** (efímera), en `test/integration/`:

| Área | Archivos (`test/integration/<nombre>.int.test.ts`) |
|------|----------|
| API pública (`/api/v1`) | `boards-api`, `board-detail-api`, `cards-api`, `api-scopes`, `api-auth` |
| Autorización de Server Actions | `authz-actions`, `cards-actions`, `security`, `labels`, `members`, `board-metadata` |
| Sesión, login y administración | `session`, `auth`, `setup`, `users`, `admin-users`, `admin-revocation`, `tokens`, `audit` |
| Tarjetas y colaboración | `cards-due-date`, `collaboration` |
| Orden de listas y tarjetas | `positions`, `position-collation` |
| Adjuntos | `attachments-delete`, `attachments-download` |
| Notificaciones y recordatorios | `notifications`, `notifications-read`, `reminders`, `cron-reminders` |
| Tiempo real (SSE) | `realtime` |
| BD y utilidades de test | `helpers`, `prisma-pool` |

Cómo funcionan:

- Usan el **mismo `PrismaClient` que la app**, apuntado a la BD de test por `DATABASE_URL`.
  Invocan **directamente los route handlers** de `app/api/v1/**` con un `Request` (Bearer
  token), sin levantar un servidor.
- **Guardia de seguridad** (`test/integration/helpers.ts`): se niega a truncar si la BD no
  acaba en `_test`, para no tocar datos de dev/producción jamás.
- Antes de cada test, `resetDb()` hace `TRUNCATE … CASCADE` de todas las tablas del
  esquema (las lee de `pg_tables`, sin `_prisma_migrations`), vacía las cookies y
  cabeceras del stub y los contadores del rate limit.
- `vitest.integration.config.ts` aliasa `next/cache` y `next/headers` a stubs (fuera de
  Next no hay store de revalidación ni request), además de `server-only` y `@/`. Fija
  además:
  - `TZ=UTC`, para que la lógica de fechas (recordatorios) sea determinista.
  - `SESSION_SECRET` de test (una clave fija que no protege nada real), necesaria para
    firmar las sesiones.
  - `fileParallelism: false`: todos los archivos comparten la misma BD y la vacían entre
    tests, así que no pueden correr a la vez.
- **Server Actions con sesión**: el stub de `next/headers`
  (`test/stubs/next-headers.ts`) guarda cookies y cabeceras en memoria.
  - `loginAs(userId)` (en `helpers.ts`) crea una sesión real (fila `Session` + cookie
    firmada) y a partir de ahí el DAL ve a ese usuario; llamarla otra vez cambia de
    usuario.
  - Para inyectar cabeceras (p. ej. `X-Forwarded-For`) se usa `__setHeaders`;
    `__clearCookies` vacía las cookies y `__clearHeaders` las cabeceras. Se importan
    desde `../stubs/next-headers`.
  - Orden: `loginAs` solo vacía las cookies, así que las cabeceras puestas antes con
    `__setHeaders` se mantienen (p. ej. `X-Forwarded-Proto: https` → cookie `Secure`).
    `resetDb` vacía ambas, por lo que las cabeceras se ponen después de `resetDb`.
  - Las redirecciones de Next se comprueban por su `digest`:
    `rejects.toMatchObject({ digest: expect.stringContaining(";/boards;") })`.
- La lógica de creación de cuentas se extrajo a `app/lib/services/users.ts`
  (`createUserAccount`) para poder probarla sin el contexto de request (cookies/admin); la
  Server Action `createUser` la reutiliza.

## Detalles de configuración

- `vitest.config.ts` define dos alias para poder importar módulos de la app fuera de Next:
  - `server-only` → un stub vacío (`test/stubs/server-only.ts`): en los tests no hay
    frontera servidor/cliente.
  - `@/…` → la raíz del proyecto, el mismo alias que usa la app.
- Los tests importan `describe/it/expect` de `vitest` (sin globals).

## Integración continua

`.github/workflows/ci.yml` levanta un **servicio PostgreSQL** (`postgres:17`, BD
`orgtable_test`) y ejecuta, en orden:

1. **Shellcheck** de `scripts/*.sh`, `install.sh` y `docker-entrypoint.sh`. `shellcheck`
   viene instalado en el runner; en local se instala con `brew install shellcheck` y:
   ```bash
   shellcheck scripts/*.sh install.sh docker-entrypoint.sh
   ```
2. **Variables del compose**: comprueba que `docker compose config` pasa al contenedor
   `app` `CRON_SECRET`, `TRUSTED_PROXY_HOPS` y `ORGTABLE_TIMEZONE`. Si una se cae del
   `environment:`, la función que depende de ella deja de funcionar en Docker sin ningún
   error. En local:
   ```bash
   CRON_SECRET=probe TRUSTED_PROXY_HOPS=7 ORGTABLE_TIMEZONE=Europe/Madrid docker compose config \
     | grep -E 'CRON_SECRET|TRUSTED_PROXY_HOPS|ORGTABLE_TIMEZONE'
   ```
3. **Referencias de licencia**: un `git grep` falla si reaparece la licencia anterior
   fuera de los archivos excluidos. La expresión y la lista de exclusiones están en el
   paso «Check license references» de `ci.yml` (el porqué, en la ADR 0016); para
   reproducirlo en local se copia de ahí.

Estos tres pasos corren antes de instalar pnpm y Node. Después, sobre Node 22 (pnpm llega
con `pnpm/action-setup`, que lee `packageManager`):

4. `pnpm install --frozen-lockfile` — instala con el lockfile (reproducible).
5. `pnpm audit --prod --audit-level high` — falla si hay vulnerabilidades altas o
   críticas en dependencias de producción.
6. `pnpm exec prisma generate` — genera el cliente Prisma (lo necesitan el typecheck y el build).
7. `pnpm lint`
8. `pnpm typecheck`
9. `pnpm test` — tests unitarios.
10. `pnpm exec prisma migrate deploy` — crea el esquema en la BD de test del servicio.
11. `pnpm test:integration` — tests de integración contra esa BD.
12. `pnpm build`

`DATABASE_URL` apunta a la BD del servicio (`…/orgtable_test`). El build no se conecta
(rutas dinámicas); los tests de integración sí.
