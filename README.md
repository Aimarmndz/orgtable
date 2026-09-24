<div align="center">

# orgtable

**Tableros Kanban self-hosted — una alternativa a Trello.**

[![CI](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml/badge.svg)](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791.svg)](https://www.postgresql.org)

</div>

---

## Qué es

orgtable es una aplicación de tableros Kanban (tableros → listas → tarjetas con
arrastrar y soltar) que **se aloja en tu propio servidor**. Se instala con un solo
comando: Docker se autolevanta y un asistente de configuración inicial te guía para
crear la cuenta de administrador.

- 🗂️ **Tableros, listas y tarjetas** con arrastrar y soltar (ratón y teclado), detalle
  de tarjeta con etiquetas, fechas, checklists, adjuntos, asignados y comentarios.
- 👥 **Multiusuario** con roles por tablero, tiempo real y notificaciones.
- 🔎 **Búsqueda, filtros y vista de calendario**, con recordatorios de vencimiento.
- 🔌 **API REST** con tokens personales.
- 🐳 **Self-hosted con Docker**: tus datos, tu servidor. El instalador genera las
  contraseñas de la base de datos por ti.

Estado: hitos 0–13 completados; los siguientes están en la
[hoja de ruta](./docs/roadmap.md).

| Capa | Tecnología |
|------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) + React 19 |
| Lenguaje | TypeScript 5 |
| Estilos | Tailwind CSS 4 |
| Base de datos | PostgreSQL 17 |
| ORM | Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Sesiones | JWT con `jose` (cookie httpOnly) respaldado por tabla `Session` |
| Arrastrar y soltar | `@dnd-kit` + `fractional-indexing` |
| Despliegue | Docker + Docker Compose |

## Requisitos

**Para instalarlo en un servidor:**

- Linux con acceso a internet.
- Docker y Docker Compose v2 (`docker compose`). Si falta Docker, el instalador lo
  instala.
- Un puerto libre (por defecto el `3000`).
- Para un uso real: un dominio y un proxy inverso con HTTPS (Caddy o nginx).

**Para desarrollar:**

- Node.js 22 (la versión que usan el CI y la imagen Docker).
- pnpm 11, activado con `corepack enable` (la versión exacta está en `packageManager`
  de `package.json`). No uses npm ni yarn.
- Docker, para la base de datos PostgreSQL de desarrollo.

## Instalación

### En un servidor

```bash
curl -sSL https://raw.githubusercontent.com/aimarmndzz/orgtable/main/install.sh | bash
```

El instalador detecta o instala Docker, genera los secretos (`.env` con permisos `600`)
y levanta la app. Después abre `http://<IP-de-tu-servidor>:3000` y completa el
asistente inicial. Por HTTP la contraseña y la sesión viajan sin cifrar: para un uso
real, pon HTTPS delante siguiendo
[`docs/self-hosting.md`](./docs/self-hosting.md#https-y-dominio-reverse-proxy).
Guía completa e instalación manual en [`docs/installation.md`](./docs/installation.md).

### En local, para desarrollar

```bash
git clone https://github.com/aimarmndzz/orgtable.git && cd orgtable
corepack enable
pnpm install

# PostgreSQL de desarrollo en el puerto 5433
docker run -d --name orgtable-dev-pg \
  -e POSTGRES_USER=orgtable -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=orgtable \
  -p 5433:5432 postgres:17-alpine

# .env mínimo: la app exige SESSION_SECRET (16 caracteres como mínimo)
printf 'DATABASE_URL=postgresql://orgtable:devpass@localhost:5433/orgtable\nSESSION_SECRET=%s\n' \
  "$(openssl rand -hex 32)" > .env

pnpm exec prisma migrate dev     # aplica las migraciones
pnpm exec prisma generate        # genera el cliente de Prisma
pnpm dev                         # http://localhost:3000
```

Más detalles en [`docs/contributing.md`](./docs/contributing.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo con recarga en caliente. |
| `pnpm build` / `pnpm start` | Compila para producción y sirve la build. |
| `pnpm lint` | ESLint. |
| `pnpm typecheck` | Comprobación de tipos (`tsc --noEmit`). |
| `pnpm test` | Tests unitarios (sin base de datos). |
| `pnpm test:integration` | Tests de integración contra una PostgreSQL real cuyo nombre acabe en `_test` (ver [`docs/testing.md`](./docs/testing.md)). |
| `pnpm exec prisma migrate dev` | Crea y aplica migraciones en desarrollo. |
| `pnpm exec prisma migrate deploy` | Aplica las migraciones pendientes (lo hace solo el contenedor al arrancar). |
| `scripts/backup.sh` · `scripts/restore.sh` · `scripts/update.sh` | Copia de seguridad, restauración y actualización de una instalación con Docker (ver [`docs/operations.md`](./docs/operations.md)). |

## Variables de entorno

La referencia de cada variable está en
[`docs/installation.md`](./docs/installation.md#variables-de-entorno) y la plantilla
comentada en [`.env.example`](./.env.example).

- Obligatorias: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`,
  `SESSION_SECRET`.
- Opcionales: `APP_PORT`, `CRON_SECRET`, `TRUSTED_PROXY_HOPS`, `ORGTABLE_TIMEZONE`,
  `ORGTABLE_UPLOAD_DIR`, `ORGTABLE_REALTIME_PG_NOTIFY`.

## Despliegue

La imagen se construye en el propio servidor con Docker Compose (app + PostgreSQL, sin
puertos de la base de datos expuestos) y aplica las migraciones al arrancar.

- Operar en producción, HTTPS y proxy inverso: [`docs/self-hosting.md`](./docs/self-hosting.md).
- Copias de seguridad, restauración y actualizaciones: [`docs/operations.md`](./docs/operations.md).
- La imagen y la orquestación: [`docs/docker.md`](./docs/docker.md).

## Documentación

Toda la documentación vive en [`docs/`](./docs/) (índice en
[`docs/index.md`](./docs/index.md)): arquitectura, base de datos, autenticación y
autorización, [decisiones de arquitectura (ADRs)](./docs/decisions/) y
[cómo contribuir](./docs/contributing.md).

## Licencia

Software propietario de MARA-KASSA SL. Todos los derechos reservados: ver
[`LICENSE`](./LICENSE).
