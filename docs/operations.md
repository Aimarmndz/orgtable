# Operación y seguridad

Esta guía cubre las funciones operativas de orgtable: límite de intentos de login,
registro de auditoría, copias de seguridad, exportar/importar tableros y el flujo de
actualización. Para la puesta en producción general (reverse proxy, TLS), ver
[`docs/self-hosting.md`](./self-hosting.md).

## Límite de intentos de login (rate limiting)

El login está protegido contra fuerza bruta: **hasta 10 intentos por IP cada 10
minutos**. Superado el límite, el formulario responde con un aviso y un tiempo de
espera, y el intento se registra en la auditoría (`auth.login_rate_limited`).

La implementación ([`app/lib/rate-limit.ts`](../app/lib/rate-limit.ts)) es **en
memoria** (un contador por ventana fija), sin Redis ni dependencias externas. Es la
opción adecuada para el despliegue estándar de una sola instancia. La IP se obtiene de
`X-Forwarded-For` / `X-Real-IP`, así que conviene tener un reverse proxy que las fije
(ver self-hosting). La decisión está en
[ADR 0009](./decisions/0009-in-memory-rate-limit.md).

> **Multi-instancia:** el conteo es por réplica. Con N réplicas el límite efectivo es
> N×10. Para un límite global compartido haría falta un store común (p. ej.
> `LISTEN/NOTIFY` no sirve aquí; sería Postgres con una tabla o Redis). No es el caso
> por defecto y queda como mejora futura.

## Registro de auditoría

orgtable guarda una fila por evento relevante de seguridad y operación en la tabla
`AuditLog` ([`app/lib/audit.ts`](../app/lib/audit.ts)). El administrador los consulta
en **`/admin/audit`** (los 200 más recientes).

Eventos registrados:

| Área | Acciones |
| --- | --- |
| Autenticación | `auth.login`, `auth.login_failed`, `auth.login_rate_limited`, `auth.logout` |
| Configuración | `setup.completed` |
| Usuarios | `user.created`, `user.deleted`, `user.role_changed`, `user.password_reset`, `user.sessions_revoked` |
| Tableros | `board.created`, `board.deleted` |
| Miembros | `member.added`, `member.removed`, `member.role_changed` |

Cada fila guarda quién (usuario, opcional), la IP, el objetivo (`targetType`/
`targetId`), un detalle y la marca de tiempo. El `userId` es **opcional con
`onDelete: SetNull`**: borrar una cuenta no borra su rastro de auditoría. El registro
es *best-effort*: un fallo al escribir el log nunca hace fallar la operación que lo
origina.
