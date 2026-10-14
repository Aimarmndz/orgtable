# Live sync (real time)

When several people have the same board open, changes made by one of them appear on the
others' screens **without reloading**. orgtable does this with **Server-Sent Events
(SSE)** and a publish/subscribe bus on the server.

> The same bus has two kinds of channel: **per board** (`board:<id>`, this page) and **per
> user** (`user:<id>`), used by notifications. The pattern is identical (publish a "ping" →
> SSE → `router.refresh()`); see [docs/notifications.md](./notifications.md).

## How it works, end to end

```
Person A moves a card
   │
   ▼
Server Action (moveCard)  ──►  revalidateBoard(boardId)
   │                                │
   │                                ├─► revalidatePath(`/board/${id}`)   (for anyone who reloads)
   │                                └─► publishBoardEvent(boardId)        (in-process bus)
   │                                          │
   ▼                                          ▼
                              ┌──────────────────────────────┐
                              │  Event bus (EventEmitter)      │
                              └──────────────────────────────┘
                                           │  (one subscriber per SSE connection)
                                           ▼
   Person B  ◄── event: change ──  GET /api/boards/[id]/stream  (SSE ReadableStream)
   │
   ▼
EventSource receives "change"  ──►  router.refresh()  ──►  the server re-renders
/board/[id]  ──►  BoardView resyncs with the new data.
```

Parts:

| File | Role |
| --- | --- |
| [`app/lib/realtime/bus.ts`](../app/lib/realtime/bus.ts) | The pub/sub bus: `publishBoardEvent` and `subscribeBoard`. |
| [`app/lib/realtime/notify.ts`](../app/lib/realtime/notify.ts) | `revalidateBoard`: revalidates the route **and** publishes the event. Every mutation calls it. |
| [`app/api/boards/[id]/stream/route.ts`](../app/api/boards/[id]/stream/route.ts) | The SSE endpoint: authorizes, subscribes to the bus and sends events to the browser. |
| [`app/lib/realtime/sse.ts`](../app/lib/realtime/sse.ts) | Shared lifecycle of the SSE streams: heartbeat, access revalidation, maximum lifetime and cleanup. |
| [`app/components/board/board-realtime.tsx`](../app/components/board/board-realtime.tsx) | Client: opens the `EventSource` and calls `router.refresh()` when an event arrives or on reconnect. |
| [`app/lib/realtime/reconnect.ts`](../app/lib/realtime/reconnect.ts) | `keepEventSourceOpen`: refreshes on every reopen except the first and, if the stream ends up `CLOSED`, checks the status (`probeStatus`) and recreates the `EventSource` with backoff. `scheduleRefresh`: shared debounce for refreshes. |

## Why SSE (and not WebSockets)

orgtable's flow is **server → client** (announcing that "something changed"). There is no
need for a bidirectional channel: mutations still go through Server Actions over HTTP. SSE
is simpler than WebSockets, runs over plain HTTP (it goes through proxies without an
upgrade), and the browser **reconnects by itself** with `EventSource`. The event only says
"this board changed"; the client reloads the data with `router.refresh()`, so the payload
is minimal and what is drawn always comes from the database.

Known limitation: the server **does not store or replay** events (there is no
`Last-Event-ID`). Whatever changes while the connection is down (laptop sleep, server
restart, network outage) does not arrive as an event. To avoid stale data, the client
calls `router.refresh()` **every time the `EventSource` reopens** (all times except the
first, when the page has just been rendered).

`EventSource` only retries on its own if the connection drops; if the server answers with
anything other than 200 (401/403 because the session or access was revoked, or the 502 of
a TLS proxy while `scripts/update.sh` restarts the app), it stays `CLOSED` for good.
`keepEventSourceOpen` (`app/lib/realtime/reconnect.ts`) handles that, and both the board
and the notification bell use it:

1. Since `EventSource` does not expose the HTTP status, `probeStatus(url)` asks for it with
   a `GET` to the same endpoint that is aborted as soon as the headers arrive (with a 200
   the stream opens and closes right away).
2. Only on **401/403** is `onAccessDenied` called; it requests a refresh through
   `scheduleRefresh` so the page redirects to `/login` or `/boards` (unmounting cancels
   the retry).
3. On a **5xx, a network error or a failure of the check itself**, there is no refresh:
   only a new `EventSource` is created with exponential backoff from 3 s to 30 s. Once it
   reopens, `onReconnect` resyncs with the now-healthy server and the backoff resets.
4. The check has a 10 s deadline (`PROBE_TIMEOUT_MS`): if the proxy holds the connection
   or the server never answers, it is aborted and retried as on a network error.
   Unmounting the component also aborts it.

Why not refresh blindly: in Next 16, if the RSC request of a `router.refresh()` gets a
non-OK response or fails at the network level, the router performs a full navigation.
With the proxy's 502 or a transient database 500, the tab would end up on the error page
and lose anything not yet saved.

All real-time refreshes (events, reconnects and access denied) go through
`scheduleRefresh`, a 200 ms debounce **shared** by the board and the bell: on
`/board/[id]` both streams drop and come back at the same time, and a single
`router.refresh()` repaints both.

## The bus: in process by default, Postgres optional

By default the bus is an **in-memory EventEmitter**. In orgtable's standard deployment (a
single app container, see `docker-compose.yml`) the Server Actions and the SSE endpoint
live in the **same Node process**, so a published event reaches the subscribers directly.
No extra infrastructure.

For **multi-instance** deployments (several app replicas behind a load balancer), an event
published on one replica would not reach clients connected to another. For that there is
an optional bridge over **PostgreSQL `LISTEN/NOTIFY`**, not Redis, because Postgres is
already a dependency (see [ADR 0007](./decisions/0007-pg-notify-over-redis.md)):

- Enable it with `ORGTABLE_REALTIME_PG_NOTIFY=1`.
- Each instance runs `LISTEN orgtable_realtime` with a dedicated `pg` client.
- `publishBoardEvent` emits locally **and** calls `pg_notify` with the id of the origin
  instance. The other instances receive the notification and re-emit it on their local
  bus; the origin ignores it (it already emitted it), which avoids duplicates.
- The payload of each `NOTIFY` is validated with zod (`parseBridgePayload`: `kind`, `id`,
  `origin`); anyone with database access can write to the channel, so an invalid payload
  is discarded with a log warning (only its length, not its content).
- While the bridge is starting, `publishBoardEvent` waits for it to finish instead of
  dropping the event.
- If the bridge fails, it never breaks a mutation: the in-process mode keeps working. The
  failure is logged, the failed connection is closed (so connections do not pile up until
  Postgres runs out of them) and it is retried with exponential backoff from 1 s to 30 s,
  with a single timer and only while there is at least one subscriber.

## Authorization and robustness

- The SSE endpoint requires a **valid session and board membership** before opening the
  stream (it answers 401/403 and does not redirect, because it is a data connection).
- It sends a heartbeat (`: ping`) every 25 s to keep the connection alive through proxies,
  and `X-Accel-Buffering: no` to disable nginx buffering.
- **Authorization is revalidated on every heartbeat**: if the session was revoked or
  expired (ADR 0008) or the person is no longer a board member, the stream closes. At most
  they receive events for 25 more seconds. If the database query fails, it also closes
  (the client reconnects and is authorized again).
- **Maximum lifetime of 15 min**: after that the server closes the stream and the
  `EventSource` reconnects, which re-authorizes from scratch with the cookie. Like every
  reconnect, it triggers a `router.refresh()` on the client.
- Cleanup (cancelling the subscription and the heartbeat, closing the stream) is
  idempotent and is triggered by the request abort, by the stream's `cancel()`, by a failed
  `enqueue`, by losing access or by reaching the maximum lifetime. If the request arrives
  already aborted (the client left while it was being authorized), the endpoint answers
  204 without subscribing. The tests in `test/integration/realtime.int.test.ts` check that
  no listeners or timers are left on the bus.
