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

## Copias de seguridad

Hay dos cosas que respaldar: la **base de datos** (PostgreSQL) y los **adjuntos**
(volumen de disco). El script [`scripts/backup.sh`](../scripts/backup.sh) hace ambas:

```sh
scripts/backup.sh [directorio_destino]   # por defecto: ./backups
```

Genera dos ficheros con marca de tiempo:

- `orgtable-db-<fecha>.sql.gz` — volcado de `pg_dump` comprimido.
- `orgtable-uploads-<fecha>.tar.gz` — los adjuntos del volumen `/data/uploads`.

Para **restaurar** la base de datos (⚠️ sobrescribe los datos actuales):

```sh
scripts/restore.sh backups/orgtable-db-<fecha>.sql.gz
```

Los adjuntos se restauran descomprimiendo el `.tar.gz` dentro del volumen `uploads`.
Automatiza el backup con un `cron` del sistema (p. ej. diario) y guarda copias fuera
del servidor.

## Exportar e importar tableros

Independiente de las copias de seguridad de toda la instancia, cada tablero se puede
**exportar a un JSON portable** y volver a **importar** (en la misma instancia o en
otra):

- **Exportar:** en la galería de tableros, el icono de descarga de cada tablero
  (`GET /api/boards/[id]/export`). Incluye listas, tarjetas, descripciones, fechas,
  etiquetas y checklists. **No** incluye los binarios de los adjuntos.
- **Importar:** el formulario "Importar tablero" de la galería. Crea un tablero
  **nuevo** del que pasas a ser propietario, regenerando identificadores y posiciones.

Implementación: [`app/api/boards/[id]/export/route.ts`](../app/api/boards/[id]/export/route.ts)
y la Server Action `importBoard` en
[`app/lib/actions/boards.ts`](../app/lib/actions/boards.ts).

## Actualizaciones

La imagen de la app se construye localmente, así que actualizar es traer los cambios y
reconstruir. El script [`scripts/update.sh`](../scripts/update.sh) lo hace:

```sh
scripts/update.sh        # git pull --ff-only && docker compose up -d --build
```

Las **migraciones de base de datos se aplican solas** al arrancar: el
`docker-entrypoint.sh` ejecuta `prisma migrate deploy` antes de levantar el servidor.
Haz un backup (`scripts/backup.sh`) antes de actualizar.
