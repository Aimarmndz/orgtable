# Documentación de orgtable

orgtable es una aplicación de tableros Kanban open-source y self-hosted (una
alternativa a Trello), construida con Next.js 16, Prisma 7 y PostgreSQL.

Esta documentación está orientada tanto a quien quiere **auto-hospedar** la app como a
quien quiere **contribuir** al código.

## Para auto-hospedar

- [**Instalación**](./installation.md) — el instalador de un comando y la instalación manual.
- [**Asistente de configuración inicial**](./setup-wizard.md) — qué ocurre en el primer arranque.
- [**Self-hosting**](./self-hosting.md) — operar en producción: backups, actualizaciones, reverse proxy/TLS.

## Para contribuir

- [**Arquitectura**](./architecture.md) — visión general del sistema y la estructura del código.
- [**Base de datos**](./database.md) — el esquema, Prisma 7 y la estrategia de ordenación.
- [**Autenticación**](./authentication.md) — sesiones JWT, el DAL y la protección de rutas.
- [**Autorización y roles**](./authorization.md) — roles de tablero, permisos y dónde se aplican.
- [**Administración de usuarios**](./admin.md) — altas, roles y contraseñas desde `/admin/users`.
- [**Operación y seguridad**](./operations.md) — rate limiting, auditoría, backups y actualizaciones.
- [**Seguridad (postura y auditoría)**](./security.md) — modelo de amenazas, hallazgos y controles.
- [**Arrastrar y soltar**](./drag-and-drop.md) — `@dnd-kit` y fractional indexing.
- [**Tiempo real**](./realtime.md) — sincronización en vivo con SSE y el bus pub/sub.
- [**Notificaciones**](./notifications.md) — avisos in-app por usuario sobre el mismo bus.
- [**Detalle de tarjeta**](./card-detail.md) — modal, etiquetas, fechas y checklists.
- [**Colaboración en la tarjeta**](./card-collaboration.md) — asignados y comentarios.
- [**Búsqueda**](./search.md) — búsqueda global de tableros y tarjetas, acotada por acceso.
- [**Filtros de tablero**](./filters.md) — acotar las tarjetas visibles por etiqueta, asignado y vencimiento.
- [**Vista de calendario**](./calendar.md) — las tarjetas con vencimiento en una rejilla mensual.
- [**Recordatorios de vencimiento**](./reminders.md) — el cron de avisos y el arrastre para reprogramar.
- [**Adjuntos**](./attachments.md) — archivos en tarjetas, almacenamiento y descarga autorizada.
- [**Sistema de diseño**](./design-system.md) — tokens OKLCH, tema claro/oscuro, componentes.
- [**Docker**](./docker.md) — la imagen multi-stage y la orquestación.
- [**API de Server Actions**](./api/server-actions.md) — catálogo de mutaciones del servidor.
- [**API pública (REST v1)**](./api/public-api.md) — automatizar tableros con tokens de acceso.
- [**Contribuir**](./contributing.md) — entorno de desarrollo y convenciones.
- [**Tests e integración continua**](./testing.md) — Vitest y el workflow de GitHub Actions.

## Decisiones de arquitectura (ADRs)

Las decisiones técnicas importantes y su porqué están registradas en
[`decisions/`](./decisions/):

- [0001 — Prisma como ORM](./decisions/0001-prisma.md)
- [0002 — Fractional indexing para el orden](./decisions/0002-fractional-indexing.md)
- [0003 — Credenciales de BD en `.env`](./decisions/0003-db-creds-in-env.md)
- [0004 — Sin Redis en el MVP](./decisions/0004-no-redis-mvp.md)
- [0005 — Licencia AGPL-3.0](./decisions/0005-agpl.md)
- [0006 — Autorización por rol con guardas explícitas](./decisions/0006-rbac-explicit-guards.md)
- [0007 — PostgreSQL LISTEN/NOTIFY en lugar de Redis](./decisions/0007-pg-notify-over-redis.md)
- [0008 — Almacén de sesiones en servidor](./decisions/0008-session-store.md)
- [0009 — Rate limiting en memoria](./decisions/0009-in-memory-rate-limit.md)
- [0010 — Adjuntos en disco local](./decisions/0010-local-file-storage.md)
- [0011 — Búsqueda con ILIKE acotada en el servidor](./decisions/0011-search-ilike-scoped.md)
- [0012 — Notificaciones in-app sobre el bus pub/sub](./decisions/0012-notifications.md)
- [0013 — API pública con tokens personales hasheados](./decisions/0013-api-tokens.md)
- [0014 — Modelo de colaboración en la tarjeta (asignados y comentarios)](./decisions/0014-card-collaboration.md)
- [0015 — Recordatorios por endpoint cron externo](./decisions/0015-reminders-cron.md)

## Hoja de ruta

El alcance de cada versión está en la [hoja de ruta](./roadmap.md).

> Algunos documentos (arquitectura, autenticación, arrastrar y soltar, API) se irán
> completando conforme se construye la interfaz; esta documentación crece en paralelo
> al código.
