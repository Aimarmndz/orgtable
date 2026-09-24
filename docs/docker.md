# Infraestructura Docker

Esta guía explica cómo está construida la infraestructura de contenedores de **orgtable** y por qué cada decisión está donde está. Está pensada para contribuidores que quieran **entender o modificar** la imagen y la orquestación. La infraestructura ya está construida y verificada funcionando end-to-end.

El stack se compone de:

| Pieza | Archivo | Rol |
| --- | --- | --- |
| Imagen de la app | `Dockerfile` | Build multi-stage que produce la imagen de producción de Next.js. |
| Orquestación | `docker-compose.yml` | Levanta PostgreSQL + la app, con red interna y healthchecks. |
| Arranque del contenedor | `docker-entrypoint.sh` | Aplica migraciones de Prisma y arranca el servidor. |
| Contexto de build | `.dockerignore` | Excluye lo que no debe entrar en la imagen (incluidos los secretos). |
| Salida de Next | `next.config.ts` | `output: "standalone"` empaqueta un servidor Node mínimo. |

Para instalar y ejecutar en un servidor real consulta [`installation.md`](./installation.md). Para el esquema de datos y las migraciones consulta [`database.md`](./database.md).

---

## El `Dockerfile` (multi-stage)

El `Dockerfile` tiene tres stages: `deps`, `builder` y `runner`. La idea es construir con todas las herramientas disponibles pero enviar a producción solo lo imprescindible.

### Stage `deps` — instalación de dependencias

```dockerfile
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
```

Se hace `pnpm install --frozen-lockfile` (pnpm llega por Corepack, en un stage `base`) sobre `node:22-alpine`. **El uso de Alpine aquí es deliberado, no estético.**

Alpine Linux usa **musl libc** (no glibc). Prisma descarga *engines nativos* durante la instalación, y uno de ellos es el **schema-engine** que utiliza `migrate deploy`. Al instalar dentro de Alpine, ese binario se descarga para la plataforma **`linux-musl`**, que es exactamente la que tendrá el contenedor final (también Alpine). Si las dependencias se instalaran sobre una imagen basada en glibc (p. ej. `node:22` Debian), el engine quedaría compilado para glibc y fallaría en el `runner` de Alpine. Mantener Alpine de punta a punta garantiza que el engine coincida con el sistema donde se ejecuta.

### Stage `builder` — generación de Prisma Client y build de Next

```dockerfile
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm exec prisma generate
RUN pnpm build
```

Reutiliza los `node_modules` ya instalados en `deps`, copia el código y hace dos cosas: genera el Prisma Client y construye la app.

El detalle clave es la **`DATABASE_URL` ficticia** definida *antes* de `prisma generate`:

- **Prisma 7 exige resolver `DATABASE_URL` al cargar `prisma.config.ts`.** Si la variable falta, la carga de la configuración lanza un error y `prisma generate` / `pnpm build` ni siquiera arrancan.
- Sin embargo, **ni `generate` ni el build se conectan realmente a la base de datos**. `generate` solo produce el cliente (query engine WASM, sin binario), y las páginas de la app son **dinámicas** (dependen de la sesión/auth), por lo que no consultan la BD durante el build. Es decir, la URL solo necesita *existir y ser sintácticamente válida*; nunca se abre una conexión a `localhost:5432`.

Tras esto, `pnpm build` produce `.next/standalone` gracias a `output: "standalone"` (ver [`next.config.ts`](../next.config.ts)).

### Stage `runner` — imagen final de producción

```dockerfile
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache openssl
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
# ... prisma/, prisma.config.ts, package.json

USER nextjs
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
```

Puntos importantes del `runner`:

- **`node:22-alpine`** otra vez, para que el schema-engine de Prisma (descargado en `deps` para `linux-musl`) sea compatible con el sistema en runtime.
- **`apk add --no-cache openssl`**: el schema-engine de Prisma necesita `openssl` para ejecutar `migrate deploy`. Alpine no lo trae por defecto, así que se instala explícitamente.
- **Usuario sin privilegios `nextjs` (non-root)**: se crea el grupo `nodejs` y el usuario `nextjs`, se hace `chown` del árbol de la app y se cambia a ese usuario con `USER nextjs`. La app nunca corre como root.
- **Se copian los artefactos de producción**: `.next/standalone` (el servidor Node mínimo), `.next/static`, `public`, y además `prisma/`, `prisma.config.ts` y `package.json` (necesarios para las migraciones).

#### Por qué se copia el `node_modules` **completo**

Esta es la parte menos obvia. En el `runner` se copia **todo** `node_modules` desde el `builder`, no solo `prisma` y `@prisma`:

```dockerfile
COPY --from=builder /app/node_modules ./node_modules
```

El motivo es el **CLI de Prisma**. En el arranque, el entrypoint ejecuta `prisma migrate deploy`, y ese CLI depende de **dependencias transitivas hoisteadas** —por ejemplo **`effect`**, que es usada por `@prisma/config`—. El trazado de dependencias de `output: "standalone"` **solo incluye lo que importa la propia aplicación**, no lo que importa el CLI de Prisma. Por tanto, si copiáramos solo `prisma`/`@prisma`, al CLI le faltarían piezas como `effect` y `migrate deploy` fallaría. Copiar el árbol completo garantiza que tanto la app como el CLI tengan todo lo que necesitan.

> **Mejora pendiente.** Copiar `node_modules` completo infla la imagen. A futuro se puede añadir un stage `prod-deps` que haga `pnpm install --prod --frozen-lockfile` y copiar solo ese árbol al `runner`, reduciendo el tamaño final. Queda anotado como optimización.

### Entrypoint y comando

```dockerfile
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
```

El `ENTRYPOINT` ejecuta el script de arranque (migraciones) y, al final, este hace `exec` del `CMD`, que arranca el servidor standalone (`node server.js`).

---

## `docker-entrypoint.sh` — migraciones idempotentes

```sh
#!/bin/sh
set -e

echo "[orgtable] Aplicando migraciones de la base de datos..."
node node_modules/prisma/build/index.js migrate deploy

echo "[orgtable] Arrancando el servidor..."
exec "$@"
```

En cada arranque del contenedor `app`:

1. **Aplica las migraciones pendientes** con `prisma migrate deploy`. Esta operación es **idempotente**: solo ejecuta las migraciones que aún no se han aplicado, comparando con el historial registrado en la BD. Arrancar el contenedor muchas veces no reaplica migraciones ya presentes.
2. El CLI se invoca por **ruta directa** (`node node_modules/prisma/build/index.js`) en lugar de `npx`, para **no depender de los symlinks de `.bin`** (que pueden no estar presentes según cómo se haya copiado/hoisteado `node_modules`).
3. `exec "$@"` reemplaza el proceso del script por el del `CMD` (`node server.js`), de modo que el servidor de Next pasa a ser PID 1 y recibe correctamente las señales del contenedor.

Más contexto sobre el esquema y el flujo de migraciones en [`database.md`](./database.md).

---

## `docker-compose.yml` — orquestación

Define dos servicios (`postgres` y `app`), un volumen (`pgdata`) y una red bridge interna (`orgtable`).

### Servicio `postgres`

```yaml
postgres:
  image: postgres:17-alpine
  restart: unless-stopped
  environment:
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: ${POSTGRES_DB}
  volumes:
    - pgdata:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
    interval: 5s
    timeout: 5s
    retries: 10
  networks:
    - orgtable
```

- **`postgres:17-alpine`** con persistencia en el volumen **`pgdata`** (los datos sobreviven a recreaciones del contenedor).
- **Healthcheck con `pg_isready`**: marca el servicio como `healthy` solo cuando la BD acepta conexiones. Esto es lo que permite a `app` esperar correctamente (ver más abajo).
- **No expone ningún puerto al host.** PostgreSQL solo es accesible desde la red interna `orgtable`, no desde fuera del host. **Es una decisión de seguridad**: la base de datos no debe estar publicada en la máquina anfitriona; solo la app necesita hablar con ella, y lo hace por la red de Docker.

### Servicio `app`

```yaml
app:
  build:
    context: .
    dockerfile: Dockerfile
  restart: unless-stopped
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    DATABASE_URL: ${DATABASE_URL}
    SESSION_SECRET: ${SESSION_SECRET}
    NODE_ENV: production
  ports:
    - "${APP_PORT:-3000}:3000"
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 20s
  networks:
    - orgtable
```

- **Build local** desde el `Dockerfile` del repo (`context: .`). La imagen se construye en el servidor del usuario, no se descarga de un registry.
- **`depends_on` con `condition: service_healthy`**: la app **no arranca hasta que PostgreSQL está `healthy`**. Así, cuando el entrypoint ejecute `migrate deploy`, la BD ya está aceptando conexiones.
- **Publica el puerto** `${APP_PORT:-3000}:3000` (configurable vía `APP_PORT`, por defecto `3000`). Este es el único servicio expuesto al host.
- **Healthcheck con `wget`** contra `http://127.0.0.1:3000/api/health`.

#### Por qué `127.0.0.1` y no `localhost` en el healthcheck

Este detalle estaba roto y se corrigió: **se usa `127.0.0.1` explícitamente, no `localhost`.**

Dentro del contenedor, **`localhost` resuelve a la dirección IPv6 `::1`**, mientras que el servidor standalone de Next escucha en **IPv4 `0.0.0.0`** (fijado con `HOSTNAME=0.0.0.0` en el `Dockerfile`). Con `localhost`, el `wget` intentaba conectar por IPv6 a un servidor que no escuchaba ahí y el healthcheck devolvía **"Connection refused"**, marcando el contenedor como `unhealthy` aunque la app funcionara. Forzar `127.0.0.1` (IPv4) hace que el chequeo apunte exactamente a donde el servidor está escuchando.

- **`start_period: 20s`**: da un margen al arranque inicial. El contenedor primero aplica migraciones y luego levanta el servidor, así que durante los primeros segundos el endpoint todavía no responde; `start_period` evita que esos fallos iniciales cuenten como `unhealthy`.

### Sin Redis

El stack **no incluye Redis**. Es una decisión consciente para el MVP, documentada en [`docs/decisions/0004-no-redis-mvp.md`](./decisions/0004-no-redis-mvp.md).

---

## `.dockerignore` — qué NO entra en la imagen

El `.dockerignore` reduce el contexto de build y, sobre todo, evita filtrar secretos:

| Patrón | Motivo |
| --- | --- |
| `node_modules` | Se reinstala dentro de la imagen (`pnpm install --frozen-lockfile`); no se envía el del host. |
| `.next` | Artefacto de build, se regenera dentro del contenedor. |
| `.git`, `.gitignore` | Historial y metadatos innecesarios en la imagen. |
| `.env`, `.env.*` | **CRÍTICO: los secretos nunca deben acabar en la imagen.** |
| `!.env.example` | Excepción: el ejemplo sin secretos sí se conserva. |
| `docs`, `*.md`, `.claude`, `.agents`, `skills-lock.json` | Documentación y tooling de desarrollo, irrelevantes en runtime. |
| `npm-debug.log*`, `*.tsbuildinfo` | Logs y temporales. |

El punto más importante es el de los **archivos `.env*`**: las credenciales (`DATABASE_URL`, `SESSION_SECRET`, etc.) **se inyectan por entorno en runtime** (vía `docker-compose.yml` / `.env` del host), nunca se hornean dentro de la imagen. La única excepción es `.env.example`, que es una plantilla sin valores reales. Esto está alineado con [`docs/decisions/0003-db-creds-in-env.md`](./decisions/0003-db-creds-in-env.md).

---

## Construir y ejecutar localmente

Necesitas Docker y Docker Compose, y un archivo `.env` con las variables requeridas (lo genera `install.sh`; ver [`installation.md`](./installation.md)).

Construir las imágenes:

```bash
docker compose build
```

Levantar el stack en segundo plano:

```bash
docker compose up -d
```

Comprobar el estado y los logs:

```bash
docker compose ps
docker compose logs -f app
```

Cuando ambos servicios aparezcan como `healthy`, la app estará disponible en `http://localhost:${APP_PORT:-3000}`.

Parar el stack:

```bash
docker compose down
```

(`docker compose down -v` eliminaría también el volumen `pgdata` y, con él, **todos los datos**.)

---

## Cómo fluye el arranque

El orden de arranque está coordinado por el healthcheck de Postgres y el entrypoint de la app:

1. **`postgres` arranca** y, cuando `pg_isready` responde, queda marcado como **`healthy`**.
2. **`app` arranca** (estaba esperando por `depends_on: condition: service_healthy`). Su `ENTRYPOINT` ejecuta `docker-entrypoint.sh`.
3. **El entrypoint aplica las migraciones** con `prisma migrate deploy` (idempotente: solo las que falten).
4. **El servidor arranca** vía `exec node server.js`, escuchando en IPv4 `0.0.0.0:3000`.
5. **El healthcheck pasa**: `wget` a `http://127.0.0.1:3000/api/health` responde correctamente y `app` queda marcado como **`healthy`**. `start_period` cubre el tiempo de migraciones + arranque.

```
postgres (pg_isready) ──healthy──▶ app entrypoint (migrate deploy) ──▶ node server.js ──▶ /api/health OK ──▶ app healthy
```

---

**Resumen:** un build multi-stage sobre Alpine empaqueta el standalone de Next con el `node_modules` completo para que el CLI de Prisma migre la BD en el arranque, mientras Compose coordina Postgres (privado, con healthcheck) y la app (migra y arranca) inyectando los secretos solo en runtime.
