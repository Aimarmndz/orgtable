# ADR 0012 — Notificaciones in-app sobre el bus pub/sub (sin email ni cola)

**Estado:** aceptada · **Fecha:** 2026-06-07 · **Relacionada:** [ADR 0007](./0007-pg-notify-over-redis.md), [ADR 0004](./0004-no-redis-mvp.md)

## Contexto

El Hito 8 añade notificaciones de eventos relevantes para una persona (te han añadido a
un tablero, te han cambiado el rol, te han quitado). Hay que decidir **dónde se
entregan** (in-app, email, push del navegador), **cómo se entregan en vivo** y **cómo se
guardan**.

## Decisión

- **Solo in-app**, por ahora: una campana en la barra superior con contador de no
  leídas y un desplegable. Sin email ni Web Push.
- **Persistencia** en una tabla `Notification` por usuario, con el **texto ya calculado
  en español** (no un payload estructurado): la app es monolingüe y así el render es
  trivial. `boardId` es una referencia **suave** (string sin FK).
- **Entrega en vivo reutilizando el bus de tiempo real** del Hito 4
  ([ADR 0007](./0007-pg-notify-over-redis.md)): se añade un canal **por usuario**
  (`user:<id>`) junto al canal por tablero (`board:<id>`). `notify()` escribe la fila y
  publica un "ping"; un stream SSE (`/api/notifications/stream`) lo reenvía y el cliente
  hace `router.refresh()`.
- **Best-effort**, como la auditoría: si crear la notificación o publicar falla, la
  mutación que la origina (añadir miembro, etc.) no se ve afectada.

## Justificación

- **Cero infraestructura nueva.** No se añade una cola de trabajos ni un servicio de
  email: el bus pub/sub ya existe y el puente opcional de PostgreSQL `LISTEN/NOTIFY`
  cubre el caso multi-instancia sin Redis (coherente con ADR 0004/0007).
- **El "ping" no lleva datos.** Igual que el evento de tablero, solo avisa de que hay
  algo nuevo; el cliente recarga y el servidor vuelve a consultar. Así no hay que
  serializar el contenido por el canal ni preocuparse de fugas entre usuarios: cada
  pestaña solo lee SUS notificaciones (el `WHERE` lleva el `userId` de la sesión).
- **Texto precalculado** evita una capa de plantillas/i18n para una app de un idioma.

## Consecuencias

- Sin notificaciones fuera de la app (si no tienes una pestaña abierta, las ves la
  próxima vez que entras). Email/Web Push quedan como evolución futura; encajarían como
  un consumidor más del mismo `notify()`.
- El conjunto de eventos es pequeño y vive en `app/lib/notifications.ts`
  (`NotificationType`). Añadir un evento nuevo es llamar a `notify()` desde la acción
  correspondiente.
- Documentado en [`docs/notifications.md`](../notifications.md); el canal por usuario se
  describe también en [`docs/realtime.md`](../realtime.md).
