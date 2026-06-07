# Tests e integración continua

orgtable tiene tests unitarios con **Vitest** y un workflow de **GitHub Actions** que se
ejecuta en cada push a `main` y en cada pull request.

## Ejecutar en local

```bash
npm test          # ejecuta todos los tests una vez
npm run test:watch # modo watch durante el desarrollo
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## Qué se prueba

Los tests cubren la **lógica pura** del proyecto, sin tocar la base de datos ni la red
(rápidos y deterministas). Están en `test/`:

| Archivo | Cubre |
|---------|-------|
| `test/roles.test.ts` | Jerarquía de autorización (`canEditBoard`, `canManageBoard`, `atLeastBoardRole`). El corazón del RBAC. |
| `test/ordering.test.ts` | Fractional indexing (`positionAtEnd`, `positionBetween`): el orden se mantiene y las inserciones caen entre dos claves. |
| `test/colors.test.ts` | Resolución y valores por defecto de colores de tablero/etiqueta; determinismo de `pickBoardColor`. |
| `test/tokens.test.ts` | Tokens de la API: hash SHA-256 estable, formato `orgt_`, unicidad. |
| `test/validators.test.ts` | Esquemas zod (títulos, cuerpos de la API, nombre de token), incluida la regla de "al menos un campo" al actualizar. |

### Por qué solo lógica pura (de momento)

La mayoría de los módulos de servidor dependen de Prisma y de la sesión, que requerirían
una base de datos de test. Empezamos por lo que más barato es de probar y más caro de
equivocar: la **autorización** y el **orden**. Los tests de integración (rutas, Server
Actions contra una BD efímera) son una ampliación natural; el flujo de la API ya se valida
manualmente de extremo a extremo (ver `docs/api/public-api.md`).

## Detalles de configuración

- `vitest.config.ts` define dos alias para poder importar módulos de la app fuera de Next:
  - `server-only` → un stub vacío (`test/stubs/server-only.ts`): en los tests no hay
    frontera servidor/cliente.
  - `@/…` → la raíz del proyecto, el mismo alias que usa la app.
- Los tests importan `describe/it/expect` de `vitest` (sin globals).

## Integración continua

`.github/workflows/ci.yml` ejecuta, en orden, sobre Node 20:

1. `npm ci` — instala con el lockfile (reproducible).
2. `npx prisma generate` — genera el cliente Prisma (lo necesitan el typecheck y el build).
3. `npm run lint`
4. `npm run typecheck`
5. `npm test`
6. `npm run build`

Se usa una `DATABASE_URL` ficticia: el cliente Prisma se instancia de forma perezosa y el
build solo compila (las rutas son dinámicas, no se conecta a la BD). No se ejecutan
migraciones ni seed en CI.
