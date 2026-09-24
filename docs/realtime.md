# Sincronización en vivo (tiempo real)

Cuando varias personas tienen el mismo tablero abierto, los cambios de una aparecen
en la pantalla de las demás **sin recargar**. orgtable lo consigue con
**Server-Sent Events (SSE)** y un bus de publicación/suscripción en el servidor.

> El mismo bus tiene dos tipos de canal: **por tablero** (`board:<id>`, esta página) y
> **por usuario** (`user:<id>`), que usan las notificaciones del Hito 8. El patrón es
> idéntico (publicar un "ping" → SSE → `router.refresh()`); ver
> [docs/notifications.md](./notifications.md).

## Cómo funciona, de punta a punta

```
Persona A mueve una tarjeta
   │
   ▼
Server Action (moveCard)  ──►  revalidateBoard(boardId)
   │                                │
   │                                ├─► revalidatePath(`/board/${id}`)   (para quien recargue)
   │                                └─► publishBoardEvent(boardId)        (bus en proceso)
   │                                          │
   ▼                                          ▼
                              ┌──────────────────────────────┐
                              │  Bus de eventos (EventEmitter) │
                              └──────────────────────────────┘
                                           │  (un suscriptor por conexión SSE)
                                           ▼
   Persona B  ◄── event: change ──  GET /api/boards/[id]/stream  (ReadableStream SSE)
   │
   ▼
EventSource recibe "change"  ──►  router.refresh()  ──►  el servidor vuelve a
renderizar /board/[id]  ──►  BoardView se resincroniza con los datos nuevos.
```

Piezas:

| Archivo | Rol |
| --- | --- |
| [`app/lib/realtime/bus.ts`](../app/lib/realtime/bus.ts) | El bus pub/sub: `publishBoardEvent` y `subscribeBoard`. |
| [`app/lib/realtime/notify.ts`](../app/lib/realtime/notify.ts) | `revalidateBoard`: revalida la ruta **y** publica el evento. Lo llaman todas las mutaciones. |
| [`app/api/boards/[id]/stream/route.ts`](../app/api/boards/[id]/stream/route.ts) | El endpoint SSE: autoriza, se suscribe al bus y emite eventos al navegador. |
| [`app/lib/realtime/sse.ts`](../app/lib/realtime/sse.ts) | Ciclo de vida común de los streams SSE: latido, revalidación del acceso, vida máxima y limpieza. |
| [`app/components/board/board-realtime.tsx`](../app/components/board/board-realtime.tsx) | Cliente: abre el `EventSource` y hace `router.refresh()` al recibir un evento. |

## Por qué SSE (y no WebSockets)

El flujo de orgtable es **servidor → cliente** (avisar de "algo cambió"). No hace falta
un canal bidireccional: las mutaciones siguen yendo por Server Actions sobre HTTP. SSE
es más simple que WebSockets, viaja sobre HTTP normal (atraviesa proxies sin upgrade),
y el navegador **reconecta solo** con `EventSource`. El evento solo dice "este tablero
cambió"; el cliente recarga los datos con `router.refresh()`, así que el payload es
mínimo y nunca se desincroniza con la base de datos.

## El bus: en proceso por defecto, Postgres opcional

Por defecto el bus es un **EventEmitter en memoria**. En el despliegue estándar de
orgtable (un único contenedor de app, ver `docker-compose.yml`) las Server Actions y el
endpoint SSE viven en el **mismo proceso Node**, así que un evento publicado llega a los
suscriptores directamente. Cero infraestructura extra.

Para despliegues **multi-instancia** (varias réplicas de la app tras un balanceador),
un evento publicado en una réplica no llegaría a los clientes conectados a otra. Para
eso hay un puente opcional sobre **PostgreSQL `LISTEN/NOTIFY`** —no Redis, porque ya
dependemos de Postgres (ver [ADR 0007](./decisions/0007-pg-notify-over-redis.md)):

- Se activa con `ORGTABLE_REALTIME_PG_NOTIFY=1`.
- Cada instancia hace `LISTEN orgtable_realtime` con un cliente `pg` dedicado.
- `publishBoardEvent` emite localmente **y** hace `pg_notify` con el id de la instancia
  de origen. Las demás instancias reciben la notificación y la reemiten en su bus local;
  la de origen la ignora (ya la emitió en el acto), evitando duplicados.
- Si el puente falla, nunca rompe una mutación: el modo en proceso sigue funcionando.

## Autorización y robustez

- El endpoint SSE exige **sesión válida + ser miembro** del tablero antes de abrir el
  stream (responde 401/403, no redirige, porque es una conexión de datos).
- Envía un latido (`: ping`) cada 25 s para mantener viva la conexión a través de
  proxies, y `X-Accel-Buffering: no` para desactivar el buffering de nginx.
- **La autorización se revalida en cada latido**: si la sesión se revocó o caducó (ADR
  0008) o la persona dejó de ser miembro del tablero, el stream se cierra. Como mucho
  recibe eventos durante 25 s más. Si la consulta a la BD falla, también se cierra (el
  cliente reconecta y se autoriza de nuevo).
- **Vida máxima de 15 min**: pasado ese tiempo el servidor cierra el stream y el
  `EventSource` reconecta, lo que vuelve a autorizar desde cero con la cookie.
- La limpieza (cancelar la suscripción y el latido, cerrar el stream) es idempotente y
  se dispara desde el abort de la petición, desde `cancel()` del stream, al fallar un
  `enqueue`, al perder el acceso o al llegar a la vida máxima. Si la petición llega ya
  abortada (el cliente se fue mientras se autorizaba), se responde 204 sin suscribirse.
  Los tests de `test/integration/realtime.int.test.ts` comprueban que no quedan
  listeners en el bus ni temporizadores.
