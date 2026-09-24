# Self-hosting: operar orgtable en producción

Esta guía cubre el día a día de una instancia de orgtable ya instalada (ver
[instalación](./installation.md)). Todo gira en torno al `docker-compose.yml` y al
`.env` generados durante la instalación.

## Comandos básicos

Desde el directorio de instalación (por defecto `~/orgtable`):

```bash
docker compose ps               # estado de los servicios
docker compose logs -f app      # logs de la aplicación en vivo
docker compose logs -f postgres # logs de la base de datos
docker compose restart app      # reiniciar solo la app
docker compose down             # parar todo (los datos persisten en el volumen)
docker compose up -d            # levantar de nuevo
```

## Actualizar a una versión nueva

La imagen se construye localmente, así que actualizar es traer el código nuevo y
reconstruir. Hay un script que lo hace:

```bash
cd ~/orgtable
scripts/update.sh        # copia de seguridad, git pull --ff-only y docker compose up -d --build
```

Las migraciones de base de datos pendientes se aplican **solas** al arrancar el
contenedor (`prisma migrate deploy` en el entrypoint; es idempotente). El script hace
antes una copia de seguridad y no actualiza si la copia falla; un `docker compose up -d
--build` a mano no la hace. Ver [docker.md](./docker.md) y
[operations.md](./operations.md#actualizaciones).

## Copias de seguridad

Hay **dos** cosas que respaldar: la base de datos (volumen `pgdata`) y los **adjuntos**
(volumen `uploads`). El script [`scripts/backup.sh`](../scripts/backup.sh) hace ambas:

```bash
scripts/backup.sh                 # genera backups/orgtable-db-*.sql.gz y -uploads-*.tar.gz
scripts/restore.sh backups/orgtable-db-<fecha>.sql.gz   # restaurar la BD
```

> Programa `scripts/backup.sh` con un `cron` del sistema y guarda copias fuera del
> servidor. Las copias contienen datos personales. Detalles completos (cron, permisos,
> restauración de adjuntos, exportar/importar tableros sueltos) en
> [operations.md](./operations.md#copias-de-seguridad).

## El archivo `.env`

Contiene los secretos de la instancia (contraseña de PostgreSQL, `SESSION_SECRET`).
Generado con permisos `600` por el instalador.

- **No lo borres ni cambies `POSTGRES_PASSWORD`** una vez creado el volumen: PostgreSQL
  fija la contraseña en la primera inicialización del volumen, así que cambiarla
  después provoca errores de autenticación (tendrías que recrear el volumen y perder
  los datos).
- Si cambias `SESSION_SECRET`, todas las sesiones activas se invalidan (los usuarios
  tendrán que volver a iniciar sesión).

## HTTPS y dominio (reverse proxy)

orgtable sirve HTTP plano en el puerto `APP_PORT` (3000 por defecto). Para producción,
ponlo detrás de un reverse proxy con TLS. Ejemplo con **Caddy** (certificados
automáticos):

```caddyfile
tablero.midominio.com {
    reverse_proxy localhost:3000
}
```

Con TLS por delante, la cookie de sesión (`secure`, `sameSite=lax`) funciona como se
espera. Para exponer solo el proxy, mantén el puerto de la app accesible únicamente en
local (`127.0.0.1:3000`) ajustando el mapeo de puertos en `docker-compose.yml`.

## Seguridad

- **PostgreSQL no se expone al host**: en el `docker-compose.yml` el servicio
  `postgres` no publica puertos, solo es accesible desde la red interna de Compose.
- Mantén el servidor y Docker actualizados.
- Restringe el acceso al puerto de la app con un firewall si no usas reverse proxy.

## Restablecer el asistente de configuración

El estado "configurado" vive en la fila `InstanceConfig` de la base de datos. Si
necesitas volver a ejecutar el [asistente inicial](./setup-wizard.md) (por ejemplo en
una demo), borra esa fila:

```bash
docker compose exec -T postgres psql -U orgtable orgtable \
  -c 'DELETE FROM "InstanceConfig";'
```

La próxima visita mostrará de nuevo el asistente. (Esto no borra usuarios ni tableros
existentes; úsalo con cuidado.)
