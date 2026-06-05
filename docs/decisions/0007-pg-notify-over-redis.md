# ADR 0007 — PostgreSQL LISTEN/NOTIFY en lugar de Redis para pub/sub

**Estado:** aceptada · **Fecha:** 2026-06-05 · **Relacionada:** [ADR 0004](./0004-no-redis-mvp.md)

## Contexto

El Hito 4 introduce la sincronización en vivo: cuando alguien cambia un tablero, el
resto de personas con ese tablero abierto deben verlo sin recargar. Eso necesita un
mecanismo de **publicación/suscripción** entre el código que muta (Server Actions) y
las conexiones abiertas (SSE).

La [ADR 0004](./0004-no-redis-mvp.md) anticipaba que Redis entraría "cuando llegue el
tiempo real con pub/sub". Al implementarlo, reconsideramos esa suposición.

## Decisión

**No añadir Redis.** El bus es **en proceso** (un `EventEmitter`) por defecto, y para
despliegues multi-instancia se usa **PostgreSQL `LISTEN/NOTIFY`** como puente opcional
(`ORGTABLE_REALTIME_PG_NOTIFY=1`).

## Justificación

- **Una pieza menos de infraestructura.** Ya dependemos de PostgreSQL. Añadir Redis
  significaría otro servicio que instalar, operar, respaldar y vigilar — justo lo que
  una app self-hosted intenta evitar.
- **El caso por defecto no necesita nada.** El despliegue estándar es un solo
  contenedor de app: Server Actions y SSE comparten proceso, así que un `EventEmitter`
  en memoria basta. Redis sería complejidad muerta para el 95 % de las instalaciones.
- **`LISTEN/NOTIFY` cubre el multi-instancia.** Para varias réplicas, Postgres ya
  ofrece pub/sub nativo. El payload de orgtable es diminuto ("el tablero X cambió"),
  muy por debajo del límite de 8 KB de `NOTIFY`.
- **Degradación segura.** Si el puente falla, el modo en proceso sigue funcionando; una
  mutación nunca se rompe por un problema de pub/sub.

## Consecuencias

- El bus vive en `app/lib/realtime/bus.ts` con una interfaz (`publishBoardEvent` /
  `subscribeBoard`) que aísla el transporte. Si algún día hiciera falta Redis (p. ej.
  por escala muy alta de fan-out), se añadiría como otro adaptador sin tocar las
  Server Actions ni el endpoint SSE.
- `docker-compose.yml` sigue con solo `app` + `postgres`.
- ADR 0004 queda **actualizada**: Redis no entra con el tiempo real; se elige
  `LISTEN/NOTIFY`.
