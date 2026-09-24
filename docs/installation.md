# Instalación

Esta guía explica cómo auto-hospedar **orgtable** (un clon de Trello self-hosted basado en Next.js 16, Prisma 7 y PostgreSQL) en tu propio servidor mediante Docker.

orgtable sigue un modelo de credenciales al estilo Coolify/Dokploy: **nunca tecleas credenciales de base de datos**. El instalador las genera automáticamente y la aplicación arranca siempre con la base de datos ya conectada. Lo único que configuras tú es a través del asistente web inicial: tu usuario administrador y el nombre de la instancia.

## Requisitos

- Un servidor con **Linux**.
- **Docker** y **Docker Compose v2** (`docker compose`). Si Docker no está instalado, el instalador lo instala por ti usando [get.docker.com](https://get.docker.com).
- Un **puerto disponible** en el host para la aplicación (por defecto, el `3000`).
- Acceso a internet en el servidor (para descargar Docker, clonar el repositorio y construir la imagen).

La imagen de la aplicación se **construye localmente en tu servidor** con `docker compose build`; no se descarga de ningún registro de contenedores.

## Instalación rápida

Ejecuta este único comando en tu servidor (sustituye `<owner>` por el propietario del repositorio):

```bash
curl -sSL https://raw.githubusercontent.com/<owner>/orgtable/main/install.sh | bash
```

El instalador detecta e instala Docker si falta, clona el repositorio, genera un `.env` con secretos aleatorios y levanta los servicios. La **primera build tarda unos minutos** porque la imagen se compila en el propio servidor.

Cuando termine, abre en tu navegador:

```
http://<IP-del-servidor>:<APP_PORT>
```

Por defecto, `APP_PORT` es `3000`. Aparecerá el **asistente de configuración inicial**, donde creas tu usuario administrador y pones nombre a la instancia. Consulta [docs/setup-wizard.md](./setup-wizard.md) para ese paso.

> **HTTPS.** Por `http://` la aplicación funciona, pero la contraseña y la sesión viajan sin cifrar. Para un uso real, pon delante un proxy inverso con TLS (Caddy o nginx) antes de dar acceso a nadie más: pasos en [self-hosting.md › HTTPS y dominio](./self-hosting.md#https-y-dominio-reverse-proxy). Completa el asistente en cuanto arranque la instalación: mientras esté abierto, quien llegue antes a la app crea el administrador.

## Qué hace el instalador

El script `install.sh` realiza, paso a paso, lo siguiente:

1. **Comprueba Docker.** Si el comando `docker` no existe, lo instala con `curl -fsSL https://get.docker.com | sh`. A continuación verifica que esté disponible **Docker Compose v2** (`docker compose`); si no lo está, aborta con un mensaje de error.

2. **Clona o actualiza el código fuente.** El repositorio se instala en `$HOME/orgtable`:
   - Si el directorio ya contiene un repositorio git, lo actualiza con `git pull --ff-only`.
   - Si no existe, lo clona con `git clone`.

   Esto es configurable mediante variables de entorno:
   - `ORGTABLE_DIR`: directorio de instalación (por defecto `$HOME/orgtable`).
   - `ORGTABLE_REPO`: URL del repositorio (por defecto `https://github.com/aimarmndzz/orgtable.git`).

3. **Genera el `.env` con secretos aleatorios.** Solo si **no existe** ya un `.env`. En ese caso:
   - Genera `POSTGRES_PASSWORD` con `openssl rand -hex 24`.
   - Genera `SESSION_SECRET` con `openssl rand -hex 32`.
   - Genera `CRON_SECRET` con `openssl rand -hex 32` (el secreto de los [recordatorios de vencimiento](./reminders.md)).
   - Construye automáticamente el `DATABASE_URL` a partir de esas credenciales.
   - Escribe el archivo y le aplica permisos `600` (`chmod 600 .env`).

   Si el `.env` ya existe y no tiene `CRON_SECRET`, se lo añade sin tocar el resto.

4. **Construye y levanta los servicios.** Ejecuta `docker compose build` (la primera vez tarda unos minutos) y luego `docker compose up -d`.

5. **Muestra la URL de acceso.** Detecta la IP del servidor y el puerto configurado, imprime la dirección donde completar el asistente de configuración inicial y recuerda que para un uso real hace falta HTTPS. Si `APP_PORT` publica la app solo en local (`127.0.0.1:3000`), en vez de esa URL indica cómo llegar por el proxy inverso o por un túnel SSH.

### Idempotencia

Puedes volver a ejecutar el comando de instalación sin problema. Si lo haces:

- El repositorio se **actualiza** con `git pull --ff-only`.
- El `.env` existente **no se sobrescribe**: se conservan los secretos ya generados (`POSTGRES_PASSWORD`, `SESSION_SECRET`, etc.). Solo se añade `CRON_SECRET` si falta.
- La imagen se reconstruye y los servicios se relevantan con los cambios.

Esto hace que el instalador sirva también para **actualizar** una instalación existente.

## Instalación manual

Si prefieres no usar el script, puedes instalar orgtable a mano.

1. **Clona el repositorio** (sustituye `<owner>` por el propietario real):

   ```bash
   git clone https://github.com/<owner>/orgtable.git
   cd orgtable
   ```

2. **Crea tu archivo `.env`** a partir de la plantilla y rellénalo:

   ```bash
   cp .env.example .env
   ```

   Edita `.env` y ajusta los valores. Lo imprescindible de la plantilla `.env.example` es:

   ```env
   # --- PostgreSQL ---
   POSTGRES_USER=orgtable
   POSTGRES_PASSWORD=changeme
   POSTGRES_DB=orgtable

   DATABASE_URL=postgresql://orgtable:changeme@postgres:5432/orgtable

   # --- Aplicación ---
   # Obligatorio, mínimo 16 caracteres.
   SESSION_SECRET=

   APP_PORT=3000
   ```

   Cambia `changeme` por una contraseña real (también dentro de `DATABASE_URL`) y rellena `SESSION_SECRET` y, para los recordatorios, `CRON_SECRET`. Genera cada secreto con:

   ```bash
   openssl rand -hex 32
   ```

   El resto de variables son opcionales; están en la [tabla de abajo](#variables-de-entorno).

   Importante: el `DATABASE_URL` debe coincidir con el usuario, la contraseña y la base de datos de PostgreSQL. En docker-compose el host es `postgres` (el nombre del servicio), no `localhost`. Por seguridad, restringe los permisos del archivo:

   ```bash
   chmod 600 .env
   ```

3. **Construye y levanta los servicios:**

   ```bash
   docker compose up -d --build
   ```

   La primera build tarda unos minutos.

4. Abre `http://<IP-del-servidor>:<APP_PORT>` y completa el [asistente de configuración inicial](./setup-wizard.md). Para un uso real, pon HTTPS delante (ver el aviso de [Instalación rápida](#instalación-rápida)).

## Variables de entorno

Esta tabla es la referencia de todas las variables. Se definen en el `.env` de la raíz del proyecto; el instalador genera las obligatorias y en una instalación manual las rellenas tú. La plantilla comentada es [`.env.example`](../.env.example).

El contenedor de la app solo recibe las variables que lista `docker-compose.yml` en `environment:`. Tras cambiar el `.env`, aplica los cambios con `docker compose up -d` (recrea el contenedor; `restart` no basta).

| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `POSTGRES_USER` | Sí | Usuario de la base de datos PostgreSQL. Por defecto `orgtable`. |
| `POSTGRES_PASSWORD` | Sí | Contraseña del usuario de PostgreSQL. El instalador la genera con `openssl rand -hex 24`. |
| `POSTGRES_DB` | Sí | Nombre de la base de datos. Por defecto `orgtable`. |
| `DATABASE_URL` | Sí | Cadena de conexión que usa la aplicación. Debe ser coherente con las tres variables anteriores. El host es `postgres` (nombre del servicio en docker-compose). Formato: `postgresql://USUARIO:CONTRASEÑA@postgres:5432/BASE`. |
| `SESSION_SECRET` | Sí | Secreto para firmar las sesiones JWT, mínimo 16 caracteres: sin él (o con uno más corto) la app no puede crear sesiones y el login y el asistente inicial fallan. El instalador lo genera con `openssl rand -hex 32`. |
| `APP_PORT` | No | Puerto del host por el que se expone la aplicación. Por defecto `3000`. Admite `127.0.0.1:3000` para publicarla solo en local, detrás de un proxy inverso. Internamente, el contenedor escucha siempre en el `3000`. |
| `CRON_SECRET` | No | Secreto del endpoint de [recordatorios de vencimiento](./reminders.md). Vacío = endpoint desactivado. El instalador lo genera con `openssl rand -hex 32`. |
| `TRUSTED_PROXY_HOPS` | No | Número de proxies de confianza delante de la app (por defecto `0`: se ignora `X-Forwarded-For`). Con un proxy inverso, `1`. Ver [operations.md](./operations.md#límite-de-intentos-de-login-rate-limiting). |
| `ORGTABLE_TIMEZONE` | No | Zona horaria IANA de las fechas que formatea el servidor. Por defecto `Atlantic/Canary`. |
| `ORGTABLE_UPLOAD_DIR` | No | Directorio de los adjuntos. En Docker, `/data/uploads` (volumen `uploads`). Ver [attachments.md](./attachments.md). |
| `ORGTABLE_REALTIME_PG_NOTIFY` | No | `1` para propagar el tiempo real entre varias réplicas de la app con PostgreSQL `LISTEN/NOTIFY`. Por defecto `0`. Ver [realtime.md](./realtime.md). |

## Comandos útiles de operación

Ejecuta estos comandos desde el directorio de instalación (`$HOME/orgtable` por defecto).

Ver los logs de la aplicación en tiempo real:

```bash
docker compose logs -f app
```

Parar los servicios:

```bash
docker compose down
```

Volver a levantarlos:

```bash
docker compose up -d
```

Actualizar a la última versión (copia de seguridad, actualiza el código, reconstruye y relevanta):

```bash
scripts/update.sh
```

Volver a ejecutar el instalador (`install.sh`) también actualiza sin tocar tu `.env`, pero **no** hace la copia de seguridad previa. Detalles en [operations.md](./operations.md#actualizaciones).

Para operaciones avanzadas como **copias de seguridad** o configurar un **reverse proxy con TLS**, consulta [docs/self-hosting.md](./self-hosting.md).

## Seguridad

- **PostgreSQL no se expone al host.** El servicio de base de datos solo es accesible desde la red interna de Docker (`orgtable`); no publica ningún puerto al exterior. La aplicación se comunica con él a través del nombre de servicio `postgres`.
- **El `.env` tiene permisos `600`.** El instalador aplica `chmod 600 .env`, de modo que solo el usuario propietario puede leer los secretos (contraseña de la base de datos y secreto de sesión). Si lo creas manualmente, aplica tú mismo este permiso.
- Los secretos se generan con `openssl` (`rand -hex 24` para la contraseña de PostgreSQL y `rand -hex 32` para el secreto de sesión), por lo que son únicos para cada instalación.
