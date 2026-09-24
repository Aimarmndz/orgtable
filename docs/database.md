# Capa de datos

Esta guía documenta cómo orgtable habla con PostgreSQL: el ORM (Prisma 7), la
configuración específica de esta versión, los modelos del esquema y la estrategia
de ordenación que hace posible el drag & drop.

El stack es **Next.js 16 + Prisma 7 + PostgreSQL**. Si vienes de proyectos con
Prisma 5/6, presta atención: **Prisma 7 introduce cambios importantes** en cómo se
configura la conexión y el motor de consultas. Las secciones siguientes explican
qué cambió y por qué el código tiene la forma que tiene.

Decisiones de arquitectura relacionadas:

- [`docs/decisions/0001-prisma.md`](decisions/0001-prisma.md) — por qué Prisma y
  cómo lo configuramos en la versión 7.
- [`docs/decisions/0002-fractional-indexing.md`](decisions/0002-fractional-indexing.md)
  — por qué usamos fractional indexing para ordenar listas y tarjetas.

---

## Archivos clave

| Archivo | Rol |
| --- | --- |
| `prisma/schema.prisma` | Definición de modelos, enums, índices y relaciones. |
| `prisma.config.ts` | Configuración del CLI de Prisma 7 (Migrate). |
| `app/lib/prisma.ts` | Cliente de runtime (`PrismaClient` con driver adapter). |

---

## Prisma 7: lo que cambia respecto a versiones anteriores

Prisma 7.8 reorganiza dónde vive la URL de conexión y cómo se conecta el cliente.
Estos cuatro hechos son la base de toda la capa de datos. **No los copies de
tutoriales antiguos**, porque la mayoría describe Prisma 5/6.

### 1. La `url` ya no va en `schema.prisma`

En versiones anteriores el bloque `datasource` llevaba `url = env("DATABASE_URL")`.
En Prisma 7 eso ya **no está permitido**. El esquema solo declara el proveedor:

```prisma
datasource db {
  provider = "postgresql"
}
```

La URL que necesita el **CLI de Migrate** (para `migrate dev`, `migrate deploy`,
etc.) se define ahora en `prisma.config.ts`, en el campo `datasource.url`, usando el
helper `env()` que exporta `prisma/config`:

```ts
// prisma.config.ts
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: { path: path.join("prisma", "migrations") },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

### 2. Prisma 7 no carga `.env` automáticamente

Las versiones antiguas leían `.env` por arte de magia. Prisma 7 ya no lo hace, así
que `prisma.config.ts` lo carga a mano usando **`process.loadEnvFile()`**, una API
nativa de Node (disponible desde 20.12+). **No usamos la dependencia `dotenv`**:

```ts
// prisma.config.ts
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // .env ausente: las variables ya vienen del entorno (p. ej. docker-compose).
}
```

El `try/catch` es deliberado: en CI y en producción no existe un `.env` (las
variables se inyectan por el entorno), y el bloque simplemente lo ignora.

### 3. El query engine es WASM, no un binario de Rust

Históricamente Prisma embebía un motor de consultas en **binario Rust**, lo que
obligaba a declarar `binaryTargets` en el generator y a copiar engines a la imagen
Docker según la plataforma. En Prisma 7 **el query engine es WASM** y la conexión
directa a la base de datos en runtime se hace mediante un **driver adapter**.

Aquí usamos `@prisma/adapter-pg` (clase `PrismaPg`) sobre el driver `pg`
(node-postgres). El `PrismaClient` se instancia pasándole el adapter:

```ts
// app/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}
```

Consecuencia práctica: **no hace falta `binaryTargets`** en el generator ni copiar
engines binarios al contenedor. La imagen Docker queda más simple y portable.

### 4. El cliente es un singleton en `globalThis`

En desarrollo, Next.js recarga los módulos en caliente (HMR). Si cada recarga
creara un `PrismaClient` nuevo, se abrirían conexiones sin cerrar hasta **agotar el
pool de PostgreSQL**. Para evitarlo, guardamos la instancia en `globalThis` y la
reutilizamos:

```ts
// app/lib/prisma.ts
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

En producción el cliente se crea una sola vez (no se cachea en `globalThis`, no hace
falta). Nota: `app/lib/prisma.ts` empieza con `import "server-only"`, de modo que
este módulo nunca pueda colarse en un bundle de cliente.

---

## Modelos

El esquema vive en `prisma/schema.prisma`. Tabla resumen:

| Modelo | Representa | Por qué existe |
| --- | --- | --- |
| `InstanceConfig` | Configuración global de la instancia (fila única). | Guarda el nombre de la instancia y, sobre todo, `setupCompletedAt`: la fuente de verdad de "ya configurada". |
| `User` | Una cuenta de usuario. | Autenticación y propiedad de tableros. |
| `Board` | Un tablero (un proyecto/espacio). | Contenedor de listas, etiquetas y miembros. |
| `List` | Una columna dentro de un tablero. | Agrupa tarjetas; ordenable por drag & drop. |
| `Card` | Una tarjeta dentro de una lista. | Unidad de trabajo; ordenable y movible entre listas. |
| `Label` | Una etiqueta de color de un tablero. | Clasificación visual de tarjetas. |
| `CardLabel` | Unión muchos-a-muchos entre `Card` y `Label`. | Permite que una tarjeta tenga varias etiquetas y viceversa. |
| `BoardMember` | Membresía de un usuario en un tablero con un rol. | Punto único de autorización por tablero. |

### `InstanceConfig`

Una **fila única** con `id` fijo (`"singleton"`). Modela la configuración de toda la
instancia self-hosted.

El campo clave es **`setupCompletedAt` (DateTime opcional)**: es la **fuente de
verdad de "la instancia ya está configurada"**. Mientras sea `null`, el **setup
wizard** (`/setup`) está activo y guía la configuración inicial; en cuanto se rellena
con una fecha, el wizard queda cerrado. Toda la lógica de arranque debe consultar
este campo, no inferir el estado de otra parte.

```prisma
model InstanceConfig {
  id               String    @id @default("singleton")
  instanceName     String
  setupCompletedAt DateTime?
  createdAt        DateTime  @default(now())
}
```

### `User`

Cuenta de usuario. `email` es único, `passwordHash` guarda la contraseña ya
hasheada (nunca en claro) y `role` usa el enum `Role` (`ADMIN` | `MEMBER`,
por defecto `MEMBER`). Relaciona con los `Board` que posee (`boards`) y con sus
`memberships` (las filas `BoardMember`).

### `Board`

Un tablero. Tiene un `owner` (relación a `User`, con `onDelete: Cascade`: borrar el
usuario borra sus tableros) y campos de presentación opcionales (`description`,
`background`). Agrupa `lists`, `labels` y `members`. Lleva `@@index([ownerId])` para
listar rápido los tableros de un usuario.

### `List`

Columna de un tablero. Pertenece a un `board` (cascade) y se ordena por la columna
**`position` (string)** — fractional indexing, ver más abajo. Indexada por
`boardId`.

### `Card`

Tarjeta dentro de una lista. Pertenece a una `list` (cascade), tiene `description` y
`dueDate` opcionales, y se ordena por **`position` (string)**. El índice
`@@index([listId, position])` permite leer las tarjetas de una lista **ya ordenadas**
de forma eficiente. Las etiquetas se acceden vía la relación `labels` (a través de
`CardLabel`).

### `Label`

Etiqueta de color, definida **a nivel de tablero** (pertenece a un `board`, cascade).
Tiene `name` y `color`. Indexada por `boardId`.

### `CardLabel`

Tabla de unión **muchos-a-muchos** entre `Card` y `Label`. Su clave primaria es
compuesta (`@@id([cardId, labelId])`), lo que impide duplicar la misma etiqueta en
la misma tarjeta. Ambas relaciones son cascade. Índice adicional por `labelId`.

### `BoardMember`

Membresía de un usuario en un tablero, con un `role` (enum `BoardRole`:
`OWNER` | `EDITOR` | `VIEWER`, por defecto `EDITOR`). Clave primaria compuesta
(`@@id([boardId, userId])`).

Aunque el **MVP es de un solo usuario**, `BoardMember` (igual que `Label` y
`CardLabel`) **se crea desde ya**. La razón es deliberada: la **autorización de cada
Server Action pasa por esta tabla desde el principio**, de modo que al llegar el hito
multiusuario no haya que re-migrar el esquema ni reescribir la capa de permisos.

---

## Ordenación para drag & drop: fractional indexing

Las columnas `position` de `List` y `Card` **no son enteros ni floats**: son
**claves string lexicográficas** generadas con la librería
[`fractional-indexing`](https://github.com/rocicorp/fractional-indexing) (la técnica
que popularizó Figma).

La idea: la posición de cada fila es una cadena que se ordena alfabéticamente. Para
insertar o mover una fila entre dos vecinas, se genera una clave **intermedia** entre
la anterior y la siguiente con `generateKeyBetween(prev, next)`:

```ts
import { generateKeyBetween } from "fractional-indexing";

// Insertar entre dos tarjetas existentes:
const position = generateKeyBetween(prevCard.position, nextCard.position);

// Al principio de la lista (sin vecino previo):
const first = generateKeyBetween(null, firstCard.position);

// Al final (sin vecino siguiente):
const last = generateKeyBetween(lastCard.position, null);
```

**Por qué es mejor que un entero/float de posición:**

- **Mover una fila actualiza SOLO esa fila.** Con un entero de posición (0, 1, 2…),
  insertar en medio obliga a re-numerar todos los vecinos: muchas escrituras y
  contención. Con fractional indexing basta un único `UPDATE`.
- **Sin reindexados ni colisiones.** Siempre existe una clave entre dos claves
  distintas, así que no hay que reservar huecos ni "compactar" periódicamente como
  ocurre cuando un float se queda sin precisión entre dos valores muy juntos.
- **Amigable con la concurrencia.** Como cada movimiento toca una sola fila, dos
  usuarios moviendo tarjetas distintas casi nunca chocan.

El índice `@@index([listId, position])` de `Card` aprovecha esto para devolver las
tarjetas de una lista ya ordenadas sin un sort adicional en memoria.

Ver [`docs/decisions/0002-fractional-indexing.md`](decisions/0002-fractional-indexing.md)
para el razonamiento completo.

---

## Comandos

Generar el cliente de Prisma (tras cambiar el esquema):

```bash
pnpm exec prisma generate
```

Crear y aplicar una migración en **desarrollo** (genera el SQL y lo aplica a tu base
local):

```bash
pnpm exec prisma migrate dev --name <nombre>
```

Aplicar migraciones pendientes en **producción** / al arrancar el contenedor (no
genera nada nuevo, solo aplica lo ya versionado):

```bash
pnpm exec prisma migrate deploy
```

En **producción las migraciones las aplica el entrypoint del contenedor**: el
arranque ejecuta `prisma migrate deploy` antes de levantar la app, de modo que el
esquema esté siempre al día sin pasos manuales.
