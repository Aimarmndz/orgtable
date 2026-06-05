# ADR 0008 — Almacén de sesiones en servidor para revocación inmediata

**Estado:** aceptada · **Fecha:** 2026-06-05 · **Relacionada:** [ADR 0004](./0004-no-redis-mvp.md)

## Contexto

El MVP usaba sesiones **JWT stateless**: el token se firmaba y se validaba solo por su
firma, sin guardar nada en la base de datos. Ventaja: cero consultas para autenticar.
Inconveniente, documentado como límite conocido: **no se podía revocar un token al
instante**. `logout` borraba la cookie local, pero un token robado o una sesión en otro
dispositivo seguían válidos hasta expirar (7 días).

El Hito 4 pide "revocación inmediata de sesiones (tabla de sesiones)".

## Decisión

Introducir una tabla **`Session`** y validar cada petición contra ella. La cookie sigue
siendo un JWT firmado, pero su payload lleva el **id de la sesión** (`sid`). El DAL:

1. Verifica la firma y la expiración del JWT (como antes).
2. Busca la fila `Session` por `sid` y la rechaza si no existe, está revocada
   (`revokedAt`) o ha expirado (`expiresAt`).

## Justificación

- **Revocación inmediata y real.** Marcar `revokedAt` invalida la sesión en la
  siguiente petición. Habilita: logout que revoca de verdad, "cerrar en todos los
  dispositivos" al cambiar la contraseña, y cierre forzado por el administrador.
- **Sin Redis.** Se reутiliza PostgreSQL (coherente con [ADR 0007](./0007-pg-notify-over-redis.md)).
  No hace falta un almacén de sesiones aparte.
- **Coste acotado.** Es **una** consulta por petición, memoizada con `cache()` de React
  (una sola vez por render). Para esta clase de app self-hosted, el coste es
  despreciable frente a la ganancia de seguridad.
- **Los cambios de rol no necesitan revocación.** El rol se lee fresco de la BD en cada
  petición, así que surten efecto solos.

## Consecuencias

- Nueva migración `Session` (`userId`, `userAgent`, `createdAt`, `expiresAt`,
  `revokedAt`; FK con borrado en cascada al usuario).
- `login` y el setup crean una fila de sesión; `logout` la revoca; el reset de
  contraseña y el cierre forzado revocan todas las del usuario.
- Esto supera el límite "no hay revocación inmediata" que describía
  [`docs/authentication.md`](../authentication.md) para el MVP.
- Conviene una limpieza periódica de sesiones expiradas/revocadas (tarea de
  mantenimiento futura); no es crítica porque el DAL ya las rechaza.
