# Hoja de ruta

orgtable se construye por hitos incrementales. Esta página resume qué incluye cada
uno y su estado. El alcance puede ajustarse conforme avanza el proyecto.

## Hito 0 — Cimientos ✅ (completado)

La infraestructura sobre la que se monta todo lo demás. Sin interfaz todavía.

- [x] Esquema de base de datos (Prisma 7 + PostgreSQL) y primera migración.
- [x] Cliente Prisma con driver adapter (`@prisma/adapter-pg`).
- [x] Next.js configurado para `output: standalone`.
- [x] Endpoint de health (`/api/health`).
- [x] Imagen Docker multi-stage + `docker-compose.yml` (app + postgres).
- [x] Migraciones automáticas en el arranque del contenedor.
- [x] Instalador de un comando (`install.sh`) con generación de secretos.
- [x] Licencia AGPL-3.0 y documentación base.

## Hito 1 — MVP de extremo a extremo ✅ (completado)

El producto mínimo usable: instalar con un comando → configurar → usar como Trello.

- [x] **Asistente de configuración inicial** (`/setup`): crear el usuario administrador
      y el nombre de la instancia; bloqueo una vez completado.
- [x] **Autenticación**: sesiones JWT con `jose` (cookie httpOnly), Data Access Layer
      (`verifySession`), login/logout, protección de rutas con `proxy.ts`.
- [x] **Tableros**: crear, listar, abrir y borrar.
- [x] **Listas y tarjetas**: crear, renombrar y borrar.
- [x] **Arrastrar y soltar** de listas y tarjetas con `@dnd-kit` + fractional indexing
      + UI optimista, persistido vía Server Actions.

## Hito 2 — Detalle de tarjeta ✅ (completado)

- [x] Modal de tarjeta con descripción.
- [x] Etiquetas (labels): crear y asignar, con badges en la tarjeta.
- [x] Fechas de vencimiento (due dates), con aviso de vencida.
- [x] Checklists con ítems marcables y barra de progreso.
- [x] **Sistema de diseño** (estética Trello colorida) con tema claro y oscuro
      (toggle persistente). Ver `DESIGN.md` y `PRODUCT.md`.

## Hito 3 — Multiusuario ✅ (completado)

- [x] Invitar miembros a un tablero (`board_members`) por email, con rol.
- [x] Roles (owner / editor / viewer) y autorización por rol en cada Server Action,
      con la UI en solo lectura para los lectores. Ver `docs/authorization.md`.
- [x] Gestión de usuarios por el administrador (`/admin/users`): altas, roles,
      restablecer contraseña y borrado con salvaguardas. Ver `docs/admin.md`.

## Hito 4 — Tiempo real ✅ (completado)

- [x] Sincronización en vivo entre usuarios con **SSE** (`/api/boards/[id]/stream`) y
      un bus pub/sub; el cliente recarga con `router.refresh()`. Ver `docs/realtime.md`.
- [x] Pub/sub **en proceso** por defecto, con puente opcional vía PostgreSQL
      `LISTEN/NOTIFY` para multi-instancia (no Redis; ver
      [ADR 0007](./decisions/0007-pg-notify-over-redis.md)).
- [x] Revocación inmediata de sesiones con tabla `Session` (logout, reset de
      contraseña, cierre forzado por el admin). Ver
      [ADR 0008](./decisions/0008-session-store.md).

## Hito 5 — Operación y pulido ✅ (completado)

- [x] Backups de PostgreSQL (`scripts/backup.sh` / `restore.sh`) y exportar/importar
      tableros en JSON. Ver `docs/operations.md`.
- [x] Adjuntos en tarjetas, en disco (volumen) con descarga autorizada. Ver
      `docs/attachments.md`.
- [x] Flujo de actualización (`scripts/update.sh`; migraciones automáticas al arrancar).
- [x] Rate-limiting del login y registro de auditoría (`/admin/audit`). Ver
      `docs/operations.md`.

---

> Todos los hitos planificados (0–5) están completados. Las siguientes ideas
> (notificaciones, búsqueda, vistas de calendario, API pública...) se priorizarán según
> el uso real.
