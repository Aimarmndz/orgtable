# ADR 0015 — Recordatorios por endpoint cron externo (sin scheduler en proceso)

**Estado:** aceptada · **Fecha:** 2026-06-07 · **Relacionada:** [ADR 0004](./0004-no-redis-mvp.md), [ADR 0012](./0012-notifications.md)

## Contexto

El Hito 11 añade **recordatorios de vencimiento**: avisar a los asignados de una tarjeta
cuando vence pronto o ya venció. Eso requiere ejecutar trabajo **de forma periódica**.

## Decisión

- Un **endpoint** `POST /api/cron/reminders` que ejecuta la pasada de recordatorios, lo
  **dispara un programador externo** (cron del sistema, un sidecar en `docker compose`, un
  `schedule` de GitHub Actions, un cron de la plataforma…), no un timer dentro del proceso
  de la app.
- Se protege con un **secreto compartido** en `Authorization: Bearer <CRON_SECRET>`,
  comparado en **tiempo constante** (`crypto.timingSafeEqual`). Si `CRON_SECRET` no está
  definido, el endpoint responde `503` (desactivado).
- La lógica vive en un **servicio testeable** (`generateDueReminders(now)`), con `now`
  inyectado. Es **idempotente por día**: no repite el aviso de la misma tarjeta a la misma
  persona el mismo día (dedup por `(userId, cardId, type, createdAt >= inicio-de-hoy)`,
  usando la referencia suave `Notification.cardId`).

## Justificación

- **Cero infraestructura nueva** (coherente con ADR 0004): no añadimos una cola de
  trabajos ni un proceso planificador. Una app self-hosted ya suele tener cron disponible.
- **Sin estado en proceso**: un timer `setInterval` no sobrevive a reinicios ni se coordina
  entre réplicas; un endpoint disparado desde fuera es trivial de operar y de hacer
  idempotente.
- **Reutiliza `notify()`** ([ADR 0012](./0012-notifications.md)): los recordatorios son un
  emisor más de notificaciones in-app; si en el futuro se añade email/Web Push, llegarán
  por el mismo camino.

## Consecuencias

- Hay que configurar un cron externo (documentado en `docs/reminders.md`); si no se
  configura, simplemente no hay recordatorios (el resto de la app no se ve afectada).
- La frecuencia la decide quien opera la instancia (p. ej. una vez al día). La dedup diaria
  evita el spam aunque se invoque varias veces.
- **Email y preferencias por usuario** quedan como ampliación (backlog): encajan como otro
  consumidor de `notify()` y un modelo de preferencias, sin cambiar este diseño.
- Documentado en [`docs/reminders.md`](../reminders.md).
