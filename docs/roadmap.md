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

## Hito 4 — Tiempo real

- [ ] Sincronización en vivo entre usuarios (WebSockets/SSE).
- [ ] Redis para pub/sub (ver [ADR 0004](./decisions/0004-no-redis-mvp.md)).
- [ ] Revocación inmediata de sesiones (tabla de sesiones).

## Hito 5 — Operación y pulido

- [ ] Backups de PostgreSQL y exportar/importar tableros.
- [ ] Adjuntos en tarjetas.
- [ ] Actualizaciones (`docker compose pull && up -d`).
- [ ] Rate-limiting y registro de auditoría.
