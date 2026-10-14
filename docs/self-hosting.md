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

orgtable sirve HTTP plano en el puerto `APP_PORT` (3000 por defecto). Se puede usar así,
por ejemplo en `http://IP:3000` para el primer arranque o en una red local, pero **la
contraseña y la cookie de sesión viajan sin cifrar**. Para un uso real, ponlo detrás de
un proxy inverso con TLS.

La cookie de sesión lleva el atributo `Secure` cuando la petición llega por HTTPS:
directamente o con la cabecera `X-Forwarded-Proto: https` que añade el proxy. Por HTTP
plano se envía sin `Secure` para que el login funcione.

Tres pasos:

1. **Publica la app solo en local**, para que nadie llegue a ella sin pasar por el
   proxy. En el `.env`:

   ```env
   APP_PORT=127.0.0.1:3000
   ```

   y aplica el cambio con `docker compose up -d`. Un firewall como `ufw` **no basta**:
   Docker publica los puertos con sus propias reglas de iptables y se lo salta.

2. **Indica que hay un proxy delante**, para que el límite de intentos de login use la
   IP real del cliente ([operations.md](./operations.md#límite-de-intentos-de-login-rate-limiting)).
   En el `.env`:

   ```env
   TRUSTED_PROXY_HOPS=1
   ```

   Con `TRUSTED_PROXY_HOPS` mayor que 0 y el puerto de la app abierto al exterior,
   cualquiera podría falsear su IP con `X-Forwarded-For`: haz antes el paso 1.

3. **Configura el proxy.** Con **Caddy** (certificados automáticos):

   ```caddyfile
   tablero.midominio.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Caddy ya envía `X-Forwarded-Proto` y, mientras no configures `trusted_proxies`,
   sustituye el `X-Forwarded-For` que mande el cliente por su IP real. No añadas
   `trusted_proxies` salvo que haya otro proxy delante de Caddy.

   Con **nginx** (certificados aparte, p. ej. con certbot):

   ```nginx
   server {
       listen 443 ssl;
       server_name tablero.midominio.com;
       # ssl_certificate / ssl_certificate_key …

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           # La IP del cliente tal como la ve nginx, sin lo que mande el propio cliente.
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
           # Tiempo real (SSE): sin buffer y con conexiones largas.
           proxy_buffering off;
           proxy_read_timeout 1h;
       }
   }
   ```

## Seguridad

- **PostgreSQL no se expone al host**: en el `docker-compose.yml` el servicio
  `postgres` no publica puertos, solo es accesible desde la red interna de Compose.
- Mantén el servidor y Docker actualizados.
- Si no usas proxy inverso, recuerda que Docker se salta `ufw`: para cerrar el puerto
  de la app usa `APP_PORT=127.0.0.1:3000` o reglas en la cadena `DOCKER-USER` de
  iptables.

## Abrir la instancia al público

Si quieres que cualquiera pueda registrarse, tú pasas a ser responsable del tratamiento de
sus datos. Antes de abrir el registro en **Administración › Instancia**, sigue la lista de
[privacy.md](./privacy.md#lista-para-abrir-una-instancia-pública): HTTPS,
`TRUSTED_PROXY_HOPS`, los dos cron, copias de seguridad y tus datos legales. Si has
modificado el código, configura `ORGTABLE_SOURCE_URL` para ofrecer tu versión, como exige la
AGPL.

## Restablecer el asistente de configuración

El estado "configurado" vive en la fila `InstanceConfig` de la base de datos. Si
necesitas volver a ejecutar el [asistente inicial](./setup-wizard.md) (por ejemplo en
una demo), borra esa fila:

```bash
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "DELETE FROM \"InstanceConfig\";"'
```

La próxima visita mostrará de nuevo el asistente. Esto no borra usuarios ni tableros
existentes. Antes de hacerlo, ten en cuenta:

- **Mientras el asistente está abierto, cualquiera que llegue a la app puede crear una
  cuenta de administrador.** Publicar la app solo en local (`APP_PORT=127.0.0.1:3000`)
  no basta: detrás de un proxy inverso, `/setup` sigue abierto por el dominio. Mientras
  dure, corta ese acceso (para el proxy o bloquea `/setup` en él, p. ej. en Caddy con
  `respond /setup* 403`) y completa el asistente por un túnel SSH:
  `ssh -L 3000:127.0.0.1:3000 usuario@servidor` y abre `http://localhost:3000`. Si no
  puedes cortar el acceso, o `APP_PORT` publica la app en todas las interfaces,
  completa el asistente justo después del reseteo.
- El asistente crea un administrador **nuevo**: usa un email que no exista ya, o la
  creación fallará.
- No sirve para recuperar el acceso de un administrador existente. Para eso, ver
  [setup-wizard.md](./setup-wizard.md#recuperar-el-acceso-de-un-administrador).
