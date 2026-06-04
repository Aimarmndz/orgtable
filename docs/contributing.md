# Guía de contribución

¡Gracias por tu interés en contribuir a **orgtable**! Esta guía te ayuda a
levantar el proyecto en local y a aportar código sin sorpresas.

orgtable es un clon de Trello self-hosted construido con **Next.js 16**,
**Prisma 7**, **PostgreSQL**, **Tailwind 4** y **TypeScript**.

---

## Requisitos

- **Node.js 22+** (recomendado). Algunas dependencias del proyecto requieren una
  versión reciente de Node, así que no uses versiones por debajo de la 22.
- **Docker**, para levantar una base de datos PostgreSQL local sin tener que
  instalar Postgres en tu máquina.
- **npm** (viene incluido con Node.js).

---

## Levantar el entorno de desarrollo

Sigue estos pasos en orden.

### 1. Clonar e instalar dependencias

```bash
git clone <url-del-repositorio> orgtable
cd orgtable
npm install
```

### 2. Levantar PostgreSQL con Docker

Arranca un contenedor de Postgres para desarrollo. Usamos el puerto **5433** en
el host (mapeado al 5432 del contenedor) para no chocar con un Postgres local
que ya estés ejecutando en el 5432:

```bash
docker run -d --name orgtable-dev-pg \
  -e POSTGRES_USER=orgtable \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=orgtable \
  -p 5433:5432 \
  postgres:17-alpine
```

Para parar y arrancar el contenedor más adelante:

```bash
docker stop orgtable-dev-pg
docker start orgtable-dev-pg
```

### 3. Crear el archivo `.env`

Copia la plantilla y ajústala para apuntar al Postgres que acabas de levantar:

```bash
cp .env.example .env
```

Edita `.env` para que `DATABASE_URL` use el puerto **5433** y el usuario,
contraseña y base de datos del contenedor, y define un `SESSION_SECRET`
cualquiera para desarrollo:

```dotenv
DATABASE_URL="postgresql://orgtable:devpass@localhost:5433/orgtable"
SESSION_SECRET="un-secreto-cualquiera-para-desarrollo"
```

> Para un secreto más serio puedes generarlo con `openssl rand -hex 32`, pero en
> local cualquier cadena vale.

### 4. Aplicar migraciones y generar el cliente Prisma

```bash
npx prisma migrate dev
npx prisma generate
```

- `prisma migrate dev` aplica las migraciones existentes a tu base de datos.
- `prisma generate` genera el cliente de Prisma que usa la aplicación.

### 5. Arrancar el servidor de desarrollo

```bash
npm run dev
```

Abre **http://localhost:3000** en tu navegador. La primera vez te recibirá el
asistente de configuración inicial (`/setup`).

---

## Scripts disponibles

Definidos en `package.json`:

- **`npm run dev`** — Arranca el servidor de desarrollo de Next.js (`next dev`)
  con recarga en caliente.
- **`npm run build`** — Compila la aplicación para producción (`next build`).
- **`npm run start`** — Sirve la build de producción (`next start`). Requiere
  haber ejecutado antes `npm run build`.
- **`npm run lint`** — Ejecuta ESLint sobre el proyecto (`eslint`).

---

## Trabajar con la base de datos

El esquema vive en **`prisma/schema.prisma`**. Cualquier cambio en los modelos
pasa por una migración.

### Crear una migración

Tras editar `prisma/schema.prisma`, genera y aplica una nueva migración con un
nombre descriptivo:

```bash
npx prisma migrate dev --name <nombre-descriptivo>
```

Esto crea los ficheros de migración, los aplica a tu base de datos y regenera el
cliente automáticamente.

### Regenerar el cliente manualmente

Si necesitas regenerar el cliente de Prisma sin crear una migración:

```bash
npx prisma generate
```

Para más detalle sobre el modelo de datos, las decisiones de diseño y el uso de
*fractional indexing* para el orden de listas y tarjetas, consulta
[`docs/database.md`](./database.md).

> Nota: en Prisma 7 la `url` de la base de datos **no** vive en
> `schema.prisma`. El CLI de Migrate la toma de `prisma.config.ts` y, en
> runtime, el `PrismaClient` se conecta mediante el driver adapter
> `@prisma/adapter-pg` (ver `app/lib/prisma.ts`).

---

## Avisos de Next.js 16 (MUY IMPORTANTE)

> **Esta no es la versión de Next.js que conoces.** Como advierte
> [`AGENTS.md`](../AGENTS.md), esta versión introduce *breaking changes*: APIs,
> convenciones y estructura de ficheros pueden diferir de lo que tienes
> memorizado. **Antes de escribir código, lee la guía correspondiente en
> `node_modules/next/dist/docs/`** y atiende a los avisos de deprecación.

Los cambios más relevantes que debes tener en cuenta:

- **APIs asíncronas.** `params`, `searchParams`, `cookies()` y `headers()` son
  **asíncronos**: hay que usar `await`.

  ```ts
  // Página con params asíncronos
  export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    // ...
  }

  // cookies() / headers() también
  const cookieStore = await cookies();
  ```

- **El middleware ahora es `proxy.ts`.** El antiguo `middleware.ts` ya no se usa;
  el fichero se llama **`proxy.ts`** y exporta una función `proxy`:

  ```ts
  import type { NextRequest } from "next/server";

  export function proxy(req: NextRequest) {
    // ...
  }

  export const config = { matcher: ["/((?!_next/static).*)"] };
  ```

  Se ejecuta en runtime **Node.js**.

- **Mutaciones con Server Actions.** Las mutaciones (crear/editar/mover
  tarjetas, etc.) se implementan con **Server Actions** marcadas con
  `'use server'`.

- **`revalidateTag` lleva 2 argumentos.** Ahora se invoca como
  `revalidateTag(tag, 'max')`. Para escenarios de *read-your-writes* existe la
  nueva función `updateTag()`.

Cuando dudes sobre cualquiera de estas APIs, la fuente de verdad es
`node_modules/next/dist/docs/`, no tu memoria ni ejemplos de internet.

---

## Convenciones de código

- **TypeScript estricto.** El proyecto usa tipado estricto; evita `any` y
  resuelve los errores del compilador en lugar de silenciarlos.
- **`import "server-only"`.** Todo el código de servidor que toca secretos o la
  base de datos debe importar `server-only` para garantizar que nunca acabe en
  el bundle del cliente.
- **Client vs Server Components.** Los componentes interactivos (drag & drop,
  modales, formularios con estado) son **Client Components** (`'use client'`).
  Todo lo demás son **Server Components** por defecto.
- **Antes de abrir un PR**, ejecuta:

  ```bash
  npm run lint
  npm run build
  ```

  Ambos deben pasar sin errores.

---

## Licencia

Al contribuir, aceptas que tus aportaciones se licencien bajo **AGPL-3.0**.
Puedes leer el porqué de esta elección en
[`docs/decisions/0005-agpl.md`](./decisions/0005-agpl.md).

---

Resumen: clona el repo, levanta Postgres con Docker en el puerto 5433, configura `.env`, aplica las migraciones de Prisma y arranca con `npm run dev`, recordando que Next.js 16 trae *breaking changes* documentados en `node_modules/next/dist/docs/`.
