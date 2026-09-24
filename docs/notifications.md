# Notificaciones

Las notificaciones in-app (Hito 8) avisan a una persona de eventos que le afectan. Se
ven en la **campana de la barra superior**, con un contador de no leídas. La decisión
técnica está en [ADR 0012](./decisions/0012-notifications.md).

## Qué se notifica

Eventos de pertenencia a tableros (definidos en `NotificationType`,
`app/lib/notifications.ts`):

| Tipo | Cuándo | Enlace |
|------|--------|--------|
| `member.added` | Te añaden a un tablero | Al tablero |
| `member.role_changed` | Cambian tu rol en un tablero | Al tablero |
| `member.removed` | Te quitan de un tablero | Sin enlace (ya no tienes acceso) |

El texto se calcula en español al crear la notificación (la app es monolingüe), así que
no hay plantillas ni i18n en el render.

## Cómo funciona

1. La acción que provoca el evento (p. ej. `addBoardMember` en
   `app/lib/actions/members.ts`) llama a **`notify({ userId, type, title, body?, boardId? })`**.
2. `notify()` escribe una fila en `Notification` y **publica un evento en el bus** por el
   canal del usuario (`user:<id>`). Es best-effort: si algo falla, la mutación principal
   no se rompe. Devuelve `true` si la fila se guardó (aunque falle el aviso en vivo) y
   `false` si no; el fallo se registra con `console.error` (tipo, ids y código de error,
   nunca el título ni el cuerpo). El cron de recordatorios usa ese resultado para no contar
   avisos que no existen.
3. El navegador del destinatario tiene abierto un **EventSource** a
   `/api/notifications/stream`. Al recibir el "ping" hace `router.refresh()`.
4. El layout (`app/(app)/layout.tsx`) vuelve a consultar las notificaciones y el
   contador, y la **campana** (`app/components/notifications-bell.tsx`) se repinta.

El "ping" no transporta el contenido: solo avisa de que hay algo nuevo. Cada pestaña
solo lee **sus** notificaciones (el `WHERE` lleva el `userId` de la sesión), así que no
hay forma de que una notificación se filtre a otra persona.

## Interacción

- **Abrir una notificación**: la marca como leída y, si tiene tablero, navega a él.
- **Marcar todas**: pone a leídas todas las del usuario.
- Acciones en `app/lib/actions/notifications.ts` (`markNotificationRead`,
  `markAllNotificationsRead`); el `WHERE` siempre incluye el `userId` de la sesión.

## Entrega en vivo y multi-instancia

Reutiliza el bus de tiempo real del Hito 4 ([docs/realtime.md](./realtime.md)). En el
despliegue estándar (una sola instancia) el canal por usuario es un `EventEmitter` en
proceso. En multi-instancia, el puente opcional de PostgreSQL `LISTEN/NOTIFY`
(`ORGTABLE_REALTIME_PG_NOTIFY=1`) reemite también los eventos de usuario, no solo los de
tablero.

## Límites y evolución

- Solo in-app: si no tienes una pestaña abierta, verás las notificaciones la próxima vez
  que entres. Email o Web Push encajarían como otro consumidor de `notify()`.
- El catálogo de eventos es pequeño a propósito; añadir uno nuevo es llamar a `notify()`
  desde la acción que lo origina.
