# ADR 0004 — Sin Redis en el MVP

**Estado:** aceptada · **Fecha:** 2026-06-04

## Contexto

Muchas apps self-hosted incluyen Redis por defecto (sesiones, caché, colas). ¿Lo
necesita orgtable en su primer hito?

## Decisión

**No** incluir Redis en el MVP. El `docker-compose.yml` solo tiene `app` + `postgres`.

## Justificación

- **Sesiones**: son JWT stateless firmados con `jose` y guardados en una cookie
  httpOnly. No hay almacén de sesiones que requiera Redis.
- **Tiempo real**: el MVP no sincroniza en vivo entre usuarios, así que no hay
  pub/sub.
- **Caché de Next**: en una sola instancia, el standalone usa su caché en disco/memoria
  sin necesidad de un store externo.

Añadir Redis ahora sería complejidad muerta.

## Consecuencias

- Redis entrará cuando lleguen: (a) tiempo real con pub/sub multi-instancia, o
  (b) revocación inmediata de sesiones / rate-limiting. Ver `docs/roadmap.md`.
- La revocación inmediata de sesiones no es posible en el MVP (límite documentado en
  `docs/authentication.md`).
