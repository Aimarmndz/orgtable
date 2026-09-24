# Tests e integración continua

orgtable tiene tests unitarios con **Vitest** y un workflow de **GitHub Actions** que se
ejecuta en cada push a `main` y en cada pull request.

Hay dos niveles: **tests unitarios** (lógica pura, sin BD) y **tests de integración**
(rutas de la API y servicios contra una PostgreSQL real).

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

## Tests unitarios

Cubren la **lógica pura** del proyecto, sin tocar la base de datos ni la red (rápidos y
deterministas). Están en `test/`:

| Archivo | Cubre |
|---------|-------|
| `test/roles.test.ts` | Jerarquía de autorización (`canEditBoard`, `canManageBoard`, `atLeastBoardRole`). El corazón del RBAC. |
| `test/ordering.test.ts` | Fractional indexing (`positionAtEnd`, `positionBetween`): el orden se mantiene y las inserciones caen entre dos claves. |
| `test/colors.test.ts` | Resolución y valores por defecto de colores de tablero/etiqueta; determinismo de `pickBoardColor`. |
| `test/tokens.test.ts` | Tokens de la API: hash SHA-256 estable, formato `orgt_`, unicidad. |
| `test/validators.test.ts` | Esquemas zod (títulos, cuerpos de la API, nombre de token), incluida la regla de "al menos un campo" al actualizar. |
| `test/board-filters.test.ts` | Filtros del tablero (`cardMatchesFilters`): sin filtros pasa todo, etiqueta y asignado (OR dentro de cada dimensión), combinación con AND y estado de vencimiento. |
| `test/csp.test.ts` | Content-Security-Policy con nonce: scripts solo con el nonce, sin `eval` en producción, estilos con nonce, `frame-ancestors`, sin forzar HTTPS; nonce de 128 bits distinto en cada llamada. |
| `test/auth.test.ts` | Hash ficticio del login: 60 caracteres, mismo coste que `hashPassword`, nunca coincide y tarda del mismo orden que una verificación real. |
| `test/client-ip.test.ts` | IP del cliente con `TRUSTED_PROXY_HOPS`: 0 ignora `X-Forwarded-For`, N toma el N-ésimo valor desde la derecha, valores que no son IP, validación de la variable. |
| `test/rate-limit.test.ts` | Limitador en memoria con relojes falsos: límite exacto, `retryAfterSec`, reinicio de la ventana, claves independientes, `firstBlock` y `resetRateLimit`. |

## Tests de integración

Ejercen el código **contra una PostgreSQL real** (efímera), en `test/integration/`:

| Archivo | Cubre |
|---------|-------|
| `users.int.test.ts` | Creación de usuarios: hash de contraseña (nunca en claro), normalización del email, rechazo de duplicados, rol global. |
| `boards-api.int.test.ts` | API de tableros: `401` sin token o con token inválido, `POST` crea el tablero y deja al usuario como OWNER, `422` con título vacío, `GET` solo devuelve los tableros accesibles. |
| `cards-api.int.test.ts` | API de listas/tarjetas: un editor crea lista y tarjeta (con vencimiento), un VIEWER recibe `403`, un no-miembro `404`, y `PATCH`/`DELETE` de tarjeta. |
| `api-scopes.int.test.ts` | Tokens de la API: uno de solo lectura lee pero recibe `403` al escribir, uno completo escribe y uno caducado recibe `401`. |
| `collaboration.int.test.ts` | Asignados (solo miembros, idempotente) y que `getBoardWithLists` devuelve asignados y comentarios con su autor. |
| `reminders.int.test.ts` | Recordatorios de vencimiento: solo tarjetas asignadas que vencen pronto o están vencidas, e idempotencia en el mismo día. |
| `security.int.test.ts` | Helper `cardBelongsToBoard` (guard del IDOR de `moveCard`). |
| `session.int.test.ts` | `verifySession`: sesión válida, revocación, caducidad, `sid` de otro usuario, firma con otra clave u otro algoritmo, sin `sid`, `deleteSession`; error ruidoso sin `SESSION_SECRET`; cookie `Secure` solo por HTTPS. |
| `auth.int.test.ts` | Login: límite por cuenta aunque se falsee `X-Forwarded-For`, límite por IP con un proxy de confianza, reinicio tras un login correcto, una sola fila de auditoría por bloqueo, fallos sin el email tecleado y `values` sin la contraseña. |
| `audit.int.test.ts` | `recordAudit` no lanza si falla la escritura y lo registra en el log sin `detail` ni IP. |
| `setup.int.test.ts` | Asistente de primer arranque: dos envíos simultáneos crean un solo ADMIN, redirección sin gastar bcrypt si ya está configurado, causa del error en el log sin el email, `values` sin la contraseña. |
| `cards-actions.int.test.ts` | `moveCard` ejecutado con sesión: IDOR entre tableros, EDITOR, VIEWER, no miembro y sin sesión. |
| `authz-actions.int.test.ts` | Autorización de comentarios, checklists, subida de adjuntos (rol, vacío, tamaño máximo) y export/import de tableros. |
| `helpers.int.test.ts` | `resetDb` deja vacías todas las tablas y sin sesión el stub. |

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
  - Para inyectar cabeceras (p. ej. `X-Forwarded-For`) se usa `__setHeaders`, y
    `__clearCookies` vuelve a una petición anónima. Se importan desde
    `../stubs/next-headers`.
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
`orgtable_test`) y ejecuta, en orden, sobre Node 22 (pnpm llega con `pnpm/action-setup`, que lee
`packageManager`):

1. `pnpm install --frozen-lockfile` — instala con el lockfile (reproducible).
2. `pnpm audit --prod --audit-level high` — falla si hay vulnerabilidades altas o
   críticas en dependencias de producción.
3. `pnpm exec prisma generate` — genera el cliente Prisma (lo necesitan el typecheck y el build).
4. `pnpm lint`
5. `pnpm typecheck`
6. `pnpm test` — tests unitarios.
7. `pnpm exec prisma migrate deploy` — crea el esquema en la BD de test del servicio.
8. `pnpm test:integration` — tests de integración contra esa BD.
9. `pnpm build`

`DATABASE_URL` apunta a la BD del servicio (`…/orgtable_test`). El build no se conecta
(rutas dinámicas); los tests de integración sí.
