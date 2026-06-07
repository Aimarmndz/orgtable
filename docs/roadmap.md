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

## Hito 6 — Búsqueda global ✅ (completado)

- [x] Búsqueda de **tableros** y **tarjetas** por `title`/`description`, acotada en el
      servidor a lo que el usuario puede ver (mismo patrón de acceso que
      `getBoardsForUser`). Coincidencia `ILIKE`, sin motor de búsqueda externo
      ([ADR 0011](./decisions/0011-search-ilike-scoped.md)).
- [x] Caja de búsqueda en la barra superior + página `/search` (formulario GET, sin
      depender de JavaScript) y **deep-link** `?card=` para abrir una tarjeta desde un
      resultado. Ver [`docs/search.md`](./search.md).

## Hito 7 — Vista de calendario ✅ (completado)

- [x] Conmutador **Tablero / Calendario** en cada tablero. La vista de calendario
      coloca las tarjetas con fecha de vencimiento en una rejilla mensual (lunes
      primero), con navegación entre meses y resalte del día de hoy.
- [x] Al pulsar una tarjeta se abre su modal (se reutiliza el detalle de tarjeta y el
      tiempo real). Indexación por fecha sin desfases de zona horaria. Ver
      [`docs/calendar.md`](./calendar.md).

## Hito 8 — Notificaciones ✅ (completado)

- [x] Notificaciones in-app por usuario (te añaden / te cambian el rol / te quitan de un
      tablero), con campana y contador de no leídas en la barra superior, marcar una o
      todas como leídas, y enlace al tablero.
- [x] **Entrega en vivo reutilizando el bus pub/sub** del Hito 4 con un canal por
      usuario (`user:<id>`) y un stream SSE `/api/notifications/stream`; sin email ni
      cola ([ADR 0012](./decisions/0012-notifications.md)). Ver
      [`docs/notifications.md`](./notifications.md).

## Hito 9 — API pública ✅ (completado)

- [x] API REST `/api/v1` para tableros, listas y tarjetas (CRUD esencial), autenticada
      con **tokens de acceso personal** (`Authorization: Bearer`). El token se guarda
      hasheado (SHA-256) y se muestra una sola vez ([ADR 0013](./decisions/0013-api-tokens.md)).
- [x] La API **reutiliza la autorización por rol**: un token actúa como su dueño, con su
      mismo acceso; el rol del tablero se revalida en cada petición. Las mutaciones por
      API también emiten eventos de tiempo real.
- [x] Gestión de tokens en `/settings` (crear, ver una vez, revocar), con auditoría. Ver
      [`docs/api/public-api.md`](./api/public-api.md).

---

> **Hitos 0–12 completados.** A partir de aquí van los **próximos hitos planificados**
> (13–20): pendientes, con el alcance pensado y dónde encajan en la arquitectura actual,
> para poder arrancar cada uno directamente. El orden es orientativo; se priorizará según
> el uso real. Mantener la filosofía del proyecto: self-hosted, sin servicios externos
> obligatorios, el servidor como única autoridad, y reutilizar lo que ya existe
> (Server Actions + DAL + Prisma, RBAC, bus de tiempo real).

## Hito 10 — Colaboración en la tarjeta: asignados y comentarios ✅ (completado)

- [x] **Asignados**: modelo de unión `CardAssignee`. Asignar/quitar miembros desde el
      modal (avatares también en la cara de la tarjeta). Solo se puede asignar a miembros
      del tablero (servicio testeable `assignMemberToCard`).
- [x] **Comentarios**: modelo `Comment`, hilo plano en el modal; comentar requiere
      edición, borrar lo hace el autor o el OWNER. `revalidateBoard` para el tiempo real.
- [x] **Notificaciones** reutilizando `notify()`: `card.assigned` y `comment.added` (a los
      asignados). Tipos añadidos a `NotificationType`.
- [x] La **API** expone asignados y comentarios en las respuestas de tarjeta (lectura);
      crear/borrar por API queda como ampliación. Decisión en
      [ADR 0014](./decisions/0014-card-collaboration.md). Ver
      [`docs/card-collaboration.md`](./card-collaboration.md).

## Hito 11 — Fechas y recordatorios de vencimiento ✅ (completado)

- [x] **Recordatorios de vencimiento**: `generateDueReminders` (servicio testeable) genera
      notificaciones `due.reminder` para los asignados de tarjetas que vencen en 24 h o
      están vencidas, **idempotente por día**. Lo dispara un **cron externo** vía el
      endpoint protegido `POST /api/cron/reminders` (secreto en `Authorization: Bearer`,
      comparado en tiempo constante), sin scheduler en proceso
      ([ADR 0015](./decisions/0015-reminders-cron.md)).
- [x] **Arrastrar en el calendario** a otro día cambia el vencimiento (`@dnd-kit` +
      `setCardDueDate`). Notificaciones con **deep-link** a la tarjeta (`Notification.cardId`).
      Ver [`docs/reminders.md`](./reminders.md).

> Diferido al **backlog**: email/Web Push (otro consumidor de `notify()`, SMTP opcional) y
> preferencias de notificación por usuario. No bloquean el resto del roadmap.

## Hito 12 — Filtros de tablero ✅ (completado)

- [x] **Filtros en el tablero** por etiqueta, asignado (Hito 10) y estado de vencimiento
      (cualquiera / vencidas / con fecha / sin fecha). Barra desplegable en la cabecera que
      oculta las tarjetas que no encajan, sin recargar; el arrastre se desactiva mientras se
      filtra. Lógica pura testeable en `app/lib/board-filters.ts`. Ver
      [`docs/filters.md`](./filters.md).

> Diferido al **backlog**: búsqueda **full-text** de PostgreSQL (`tsvector` + GIN) detrás de
> `searchForUser` y filtros rápidos guardados. El `ILIKE` actual es adecuado a la escala
> self-hosted ([ADR 0011](./decisions/0011-search-ilike-scoped.md)); el full-text es una
> optimización, no un bloqueo.

## Hito 13 — API v1 completa y scopes 🔜 (planificado)

- [ ] **Ampliar la superficie** de `/api/v1`: checklists e ítems, etiquetas, adjuntos,
      miembros y **mover/reordenar** listas y tarjetas (reutilizando `positionBetween`).
- [ ] **Scopes y caducidad por token**: columnas en `ApiToken` (p. ej. `scope`
      read-only, `expiresAt`) y un chequeo extra en `authenticateApiToken`. Sin cambiar el
      modelo de autenticación ([ADR 0013](./decisions/0013-api-tokens.md) ya lo anticipa).
- [ ] **Rate limiting** de la API (reutilizar `app/lib/rate-limit.ts`) y una **referencia
      OpenAPI** generada o escrita a mano.
- [ ] Docs: ampliar `docs/api/public-api.md`.

## Hito 14 — PWA y experiencia móvil 🔜 (planificado)

- [ ] **PWA instalable**: `manifest`, iconos, service worker con shell offline básico.
- [ ] **Pulido móvil** del tablero (arrastre táctil, columnas a pantalla completa,
      objetivos de toque ≥44px) y de los modales.
- [ ] Docs: `docs/pwa.md`.

## Hito 15 — Automatizaciones (reglas tipo Butler) 🔜 (planificado)

Reglas "cuando pase X, haz Y" dentro de un tablero, al estilo de Butler de Trello, sin
servicios externos.

- [ ] Modelo `AutomationRule` (tablero, **disparador**, **condición** y **acción** en
      JSON). Disparadores: tarjeta movida a una lista, etiqueta añadida/quitada,
      vencimiento próximo/cumplido, checklist completada. Acciones: mover, asignar, poner
      etiqueta/fecha, crear checklist, notificar.
- [ ] **Ejecución enganchada al bus de eventos existente** (no un proceso aparte): cuando
      una mutación publica su evento, el motor evalúa las reglas del tablero. Ejecutar
      como el sistema, respetando los permisos del tablero.
- [ ] UI por tablero para crear/activar reglas (solo OWNER); auditoría de ejecuciones y
      **tope por evento** para evitar bucles (regla que se dispara a sí misma).
- [ ] Migración; ADR (formato de reglas y prevención de bucles). Docs: `docs/automations.md`.

## Hito 16 — Vistas adicionales: tabla y swimlanes 🔜 (planificado)

- [ ] **Vista de tabla**: todas las tarjetas del tablero en una tabla ordenable y
      filtrable (título, lista, asignado, vencimiento, etiquetas). Conmutador junto a
      Tablero / Calendario en `BoardView`.
- [ ] **Swimlanes**: agrupar el tablero en filas por etiqueta o por asignado (Hito 10).
      Estado de cliente, sin tocar el modelo de datos.
- [ ] Reutiliza los filtros del Hito 12. Docs: `docs/views.md`.

## Hito 17 — Plantillas, duplicar y archivar 🔜 (planificado)

- [ ] **Plantillas de tablero** y **duplicar** tablero/lista/tarjeta, regenerando ids y
      posiciones (reutilizando la lógica de `importBoard` en `actions/boards.ts`).
- [ ] **Archivar** en vez de borrar (tableros, listas y tarjetas): columna `archivedAt`
      nullable; ocultas por defecto, con una vista de archivados y opción de **restaurar**.
      Migración aditiva (columnas nullable, sin romper datos existentes).
- [ ] Docs: `docs/templates-archive.md`.

## Hito 18 — Actividad e historial de tarjeta 🔜 (planificado)

- [ ] Registro de **actividad por tarjeta** visible para los miembros (creada, movida,
      renombrada, comentario, asignación, cambio de vencimiento…). Modelo `CardActivity`
      propio (el `AuditLog` actual es de seguridad/operación y solo lo ve el admin).
- [ ] Sección de actividad en el modal de tarjeta y, opcional, un feed por tablero.
      Tiempo real reutilizando el bus. Migración. Docs: `docs/activity.md`.

## Hito 19 — Webhooks e integraciones 🔜 (planificado)

- [ ] **Webhooks salientes** por tablero: modelo `Webhook` (URL, secreto, eventos) y
      entrega como **otro consumidor del bus** de eventos, con **firma HMAC** del payload
      y reintentos best-effort (sin añadir una cola; coherente con ADR 0004/0007).
- [ ] **Entrada**: crear tarjetas vía **webhook entrante** con secreto (y, opcional,
      email-to-card si hay buzón configurado).
- [ ] Gestión en los ajustes del tablero (solo OWNER). ADR (firma HMAC, reintentos sin
      cola). Docs: `docs/webhooks.md`.

## Hito 20 — Internacionalización (i18n) y accesibilidad 🔜 (planificado)

- [ ] **i18n**: extraer los textos (hoy en español embebido) a un catálogo, selector de
      idioma por usuario y un **locale en inglés** como segundo idioma. Las notificaciones
      dejarían de precalcular texto fijo y pasarían a clave + datos (revisar
      [ADR 0012](./decisions/0012-notifications.md)).
- [ ] **Accesibilidad**: pasada de foco, roles ARIA y lectores de pantalla en el
      arrastrar y soltar, los modales y la campana; verificar contraste.
- [ ] ADR (estrategia i18n e impacto en notificaciones). Docs: `docs/i18n.md`.

---

### Más allá del Hito 20 (candidatos, sin alcance cerrado)

- **SSO / OIDC** opcional (OpenID Connect) además del login propio.
- **Doble factor (TOTP)** para endurecer el acceso.
- **Observabilidad**: endpoint de métricas (Prometheus), logs estructurados, readiness.
- **Backups programados desde la UI** y restauración guiada.

### Backlog continuo (mejoras menores, sin hito propio)

- **Email / Web Push** para notificaciones y recordatorios (otro consumidor de `notify()`,
  SMTP opcional por entorno) + **preferencias de notificación por usuario** (diferido del Hito 11).
- Portadas/colores por tarjeta; descripción con **Markdown**.
- Exportar el tablero también a **CSV** (hoy solo JSON).
- Reacciones/emoji en comentarios (tras el Hito 10).

> Al cerrar cada hito: marcar sus casillas, mover el encabezado a "✅ (completado)",
> actualizar `docs/index.md`, `CLAUDE.md` (decisiones + notas de hito) y escribir el ADR
> correspondiente si hubo una decisión técnica con su porqué.
