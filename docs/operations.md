# Operación y seguridad

Esta guía cubre las funciones operativas de orgtable: límite de intentos de login,
registro de auditoría, copias de seguridad, exportar/importar tableros y el flujo de
actualización. Para la puesta en producción general (reverse proxy, TLS), ver
[`docs/self-hosting.md`](./self-hosting.md).

## Límite de intentos de login (rate limiting)

El login está protegido contra fuerza bruta con dos límites:

- **Por IP: hasta 10 intentos cada 10 minutos**, solo si la IP del cliente es fiable
  (ver abajo).
- **Por email: 20 intentos fallidos cada 15 minutos**. Solo cuentan los fallos y el
  contador se reinicia tras un login correcto.

Superado un límite, el formulario responde con un aviso y un tiempo de espera, y el
intento se registra en la auditoría (`auth.login_rate_limited`).

La implementación ([`app/lib/rate-limit.ts`](../app/lib/rate-limit.ts)) es **en
memoria** (un contador por ventana fija), sin Redis ni dependencias externas. Es la
opción adecuada para el despliegue estándar de una sola instancia. La decisión está en
[ADR 0009](./decisions/0009-in-memory-rate-limit.md).

**De dónde sale la IP: `TRUSTED_PROXY_HOPS`.** La cabecera `X-Forwarded-For` la puede
escribir cualquiera, así que la app solo se fía de ella si se le dice cuántos proxies
propios hay delante:

| `TRUSTED_PROXY_HOPS` | Comportamiento |
| --- | --- |
| `0` (por defecto) | Se ignora `X-Forwarded-For`. No hay límite por IP; se aplica solo el límite por email. |
| `N > 0` | Se toma la IP N-ésima de `X-Forwarded-For` contando por la derecha. Con un único proxy inverso (Caddy o nginx), `1`. |

Con `N > 0`, el puerto de la app no debe ser accesible sin pasar por el proxy: quien
llegue directamente puede inventarse la cabecera. Cómo configurarlo, en
[self-hosting.md](./self-hosting.md#https-y-dominio-reverse-proxy).

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

- `orgtable-db-<fecha>.sql.gz` — volcado de `pg_dump --clean --if-exists` comprimido.
- `orgtable-uploads-<fecha>.tar.gz` — los adjuntos del volumen `/data/uploads`.

Cómo se comporta:

- Se puede lanzar desde cualquier directorio: se sitúa solo en la raíz de la instalación.
- Si algo falla (Postgres parado, volcado vacío o truncado, adjuntos que no se pueden
  leer), sale con un código distinto de 0, lo dice por la salida de error y no deja
  ficheros a medias. Solo imprime `✓ Backup completado` si las copias están bien.
- Los adjuntos se omiten únicamente si no existe `/data/uploads`. Si la app está parada,
  se leen con un contenedor efímero que monta el mismo volumen.
- **Las copias contienen datos personales** (emails, hashes de contraseñas y de tokens,
  comentarios). El script crea el directorio `backups/` con permisos `700` y los ficheros
  con `600`. Las copias hechas con versiones anteriores del script pueden ser legibles
  por otros usuarios del servidor; ciérralas una vez:

  ```sh
  chmod 700 backups && chmod 600 backups/*.gz
  ```

Automatiza el backup con un `cron` del sistema y guarda copias fuera del servidor.
Usa rutas absolutas, porque cron arranca en `$HOME`. Por ejemplo, cada día a las 3:30
(`crontab -e`):

```cron
30 3 * * * /home/usuario/orgtable/scripts/backup.sh >> /home/usuario/orgtable/backups/backup.log 2>&1
```

Si el script falla, el error queda en ese log; revísalo o configura `MAILTO` en el
crontab para recibirlo por correo.

### Restaurar

Para **restaurar** la base de datos (⚠️ sustituye todos los datos actuales):

```sh
scripts/restore.sh backups/orgtable-db-<fecha>.sql.gz
```

El script:

1. Comprueba que el fichero existe, que es un gzip válido y que el volcado está
   completo. Si no, sale sin tocar nada.
2. Pide confirmación.
3. Hace una **copia previa automática** en `backups/pre-restore-<fecha>/` con
   `scripts/backup.sh`. Si la copia falla, no sigue.
4. Para la app mientras restaura y, si estaba en marcha, la vuelve a arrancar al
   terminar.
5. Vacía el esquema y carga el volcado en **una sola transacción** con
   `ON_ERROR_STOP`: si algo falla, no se aplica nada y la base de datos queda como
   estaba. Funciona también con volcados antiguos hechos sin `--clean`.

Al arrancar, la app aplica las migraciones que falten si el volcado es de una versión
anterior.

Los adjuntos no se restauran con el script. Con la app parada, descomprime el
`.tar.gz` dentro del volumen `uploads` (desde la raíz de la instalación):

```sh
docker compose stop app
docker compose run --rm --no-deps -T --entrypoint sh app \
  -c 'rm -rf /data/uploads/* && tar xzf - -C /data' < backups/orgtable-uploads-<fecha>.tar.gz
docker compose start app
```

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
scripts/update.sh
```

El script, en este orden:

1. Levanta Postgres si no lo estaba y hace una **copia de seguridad** con
   `scripts/backup.sh` (queda en `backups/`). Si la copia falla, no actualiza.
2. Trae los cambios (`git pull --ff-only`).
3. Reconstruye y relanza (`docker compose up -d --build`).

Las **migraciones de base de datos se aplican solas** al arrancar: el
`docker-entrypoint.sh` ejecuta `prisma migrate deploy` antes de levantar el servidor.
Por eso la copia va antes: si una migración sale mal, se puede volver con
`scripts/restore.sh`. Un `docker compose up -d --build` lanzado a mano **no** hace esa
copia.
