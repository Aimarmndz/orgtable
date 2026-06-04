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
   - Construye automáticamente el `DATABASE_URL` a partir de esas credenciales.
   - Escribe el archivo y le aplica permisos `600` (`chmod 600 .env`).

4. **Construye y levanta los servicios.** Ejecuta `docker compose build` (la primera vez tarda unos minutos) y luego `docker compose up -d`.

5. **Muestra la URL de acceso.** Detecta la IP del servidor y el puerto configurado, e imprime la dirección donde completar el asistente de configuración inicial.

### Idempotencia

Puedes volver a ejecutar el comando de instalación sin problema. Si lo haces:

- El repositorio se **actualiza** con `git pull --ff-only`.
- El `.env` existente **no se sobrescribe**: se conservan los secretos ya generados (`POSTGRES_PASSWORD`, `SESSION_SECRET`, etc.).
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

   Edita `.env` y ajusta los valores. La plantilla `.env.example` contiene:

   ```env
   # --- PostgreSQL ---
   POSTGRES_USER=orgtable
   POSTGRES_PASSWORD=changeme
   POSTGRES_DB=orgtable

   DATABASE_URL=postgresql://orgtable:changeme@postgres:5432/orgtable

   # --- Aplicación ---
   SESSION_SECRET=changeme

   APP_PORT=3000
   ```

   Cambia los valores `changeme` por secretos reales. Puedes generar el secreto de sesión con:

   ```bash
   openssl rand -hex 32
   ```

   Importante: el `DATABASE_URL` debe coincidir con el usuario, la contraseña y la base de datos de PostgreSQL. En docker-compose el host es `postgres` (el nombre del servicio), no `localhost`. Por seguridad, restringe los permisos del archivo:

   ```bash
   chmod 600 .env
   ```

3. **Construye y levanta los servicios:**

   ```bash
   docker compose up -d --build
   ```

   La primera build tarda unos minutos.

4. Abre `http://<IP-del-servidor>:<APP_PORT>` y completa el [asistente de configuración inicial](./setup-wizard.md).

## Variables de entorno

Todas las variables se definen en el `.env` de la raíz del proyecto. El instalador las genera automáticamente; en una instalación manual las rellenas tú.

| Variable | Para qué sirve |
|---|---|
| `POSTGRES_USER` | Usuario de la base de datos PostgreSQL. Por defecto `orgtable`. |
| `POSTGRES_PASSWORD` | Contraseña del usuario de PostgreSQL. El instalador la genera con `openssl rand -hex 24`. |
| `POSTGRES_DB` | Nombre de la base de datos. Por defecto `orgtable`. |
| `DATABASE_URL` | Cadena de conexión que usa la aplicación. Debe ser coherente con las tres variables anteriores. El host es `postgres` (nombre del servicio en docker-compose). Formato: `postgresql://USUARIO:CONTRASEÑA@postgres:5432/BASE`. |
| `SESSION_SECRET` | Secreto para firmar las sesiones JWT. El instalador lo genera con `openssl rand -hex 32`. |
| `APP_PORT` | Puerto del host por el que se expone la aplicación. Por defecto `3000`. Internamente, el contenedor escucha siempre en el `3000`. |

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

Actualizar a la última versión (actualiza el código, reconstruye y relevanta):

```bash
git pull --ff-only
docker compose up -d --build
```

También puedes volver a ejecutar el instalador (`install.sh`), que hace lo mismo de forma idempotente sin tocar tu `.env`.

Para operaciones avanzadas como **copias de seguridad** o configurar un **reverse proxy con TLS**, consulta [docs/self-hosting.md](./self-hosting.md).

## Seguridad

- **PostgreSQL no se expone al host.** El servicio de base de datos solo es accesible desde la red interna de Docker (`orgtable`); no publica ningún puerto al exterior. La aplicación se comunica con él a través del nombre de servicio `postgres`.
- **El `.env` tiene permisos `600`.** El instalador aplica `chmod 600 .env`, de modo que solo el usuario propietario puede leer los secretos (contraseña de la base de datos y secreto de sesión). Si lo creas manualmente, aplica tú mismo este permiso.
- Los secretos se generan con `openssl` (`rand -hex 24` para la contraseña de PostgreSQL y `rand -hex 32` para el secreto de sesión), por lo que son únicos para cada instalación.
