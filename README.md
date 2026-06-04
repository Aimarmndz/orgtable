<div align="center">

# orgtable

**Tableros Kanban open-source y self-hosted — una alternativa a Trello.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791.svg)](https://www.postgresql.org)

</div>

---

orgtable es una aplicación de tableros Kanban (tableros → listas → tarjetas con
arrastrar y soltar) que **tú alojas en tu propio servidor**. Se instala con un solo
comando: Docker se autolevanta y un asistente de configuración inicial te guía para
crear tu cuenta de administrador.

> **Estado del proyecto:** en desarrollo activo. Los cimientos (base de datos, Docker,
> instalación) están listos; la interfaz Kanban y el asistente de configuración están
> en construcción. Ver [hoja de ruta](./docs/roadmap.md).

## Instalación rápida

En un servidor Linux con acceso a internet:

```bash
curl -sSL https://raw.githubusercontent.com/aimarmndzz/orgtable/main/install.sh | bash
```

El instalador detecta o instala Docker, genera secretos seguros automáticamente y
levanta la app. Después abre `http://<IP-de-tu-servidor>:3000` y completa el asistente
inicial. Guía completa en [`docs/installation.md`](./docs/installation.md).

## Características

- 🗂️ **Tableros, listas y tarjetas** con arrastrar y soltar fluido.
- 🔐 **Cuenta de administrador** creada en el primer arranque (asistente web).
- 🐳 **Self-hosted con Docker**: tus datos, tu servidor.
- 🔑 **Sin credenciales que teclear**: el instalador genera las contraseñas de la base
  de datos por ti (modelo Coolify/Dokploy).

> Detalle de qué entra en cada versión en la [hoja de ruta](./docs/roadmap.md).

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router) + React 19 |
| Lenguaje | TypeScript 5 |
| Estilos | Tailwind CSS 4 |
| Base de datos | PostgreSQL 17 |
| ORM | Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Sesiones | JWT con `jose` (cookie httpOnly) |
| Arrastrar y soltar | `@dnd-kit` + `fractional-indexing` |
| Despliegue | Docker + Docker Compose |

## Documentación

Toda la documentación vive en [`docs/`](./docs/):

- [Instalación](./docs/installation.md) · [Setup wizard](./docs/setup-wizard.md) · [Self-hosting](./docs/self-hosting.md)
- [Arquitectura](./docs/architecture.md) · [Base de datos](./docs/database.md) · [Docker](./docs/docker.md)
- [Decisiones de arquitectura (ADRs)](./docs/decisions/) · [Contribuir](./docs/contributing.md)

## Desarrollo local

```bash
git clone https://github.com/aimarmndzz/orgtable.git && cd orgtable
npm install
cp .env.example .env            # ajusta DATABASE_URL a tu Postgres local
npx prisma migrate dev          # aplica las migraciones
npm run dev                     # http://localhost:3000
```

Más detalles en [`docs/contributing.md`](./docs/contributing.md).

## Licencia

[GNU AGPL-3.0](./LICENSE). Si ofreces orgtable como servicio en red, debes poner tu
código a disposición de los usuarios. Ver [ADR 0005](./docs/decisions/0005-agpl.md).
