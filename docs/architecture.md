# Arquitectura de orgtable

Esta guía ofrece una visión general del sistema para contribuidores. Describe la
estructura real del repositorio, la frontera entre servidor y cliente, el flujo de
una petición y las convenciones propias de Next.js 16 que conviene tener presentes.

> Antes de escribir código, lee también [`AGENTS.md`](../AGENTS.md): esta versión de
> Next.js tiene cambios de ruptura respecto a versiones anteriores, y la documentación
> local en `node_modules/next/dist/docs/` es la fuente de verdad.

## Visión general

orgtable es un clon self-hosted de Trello construido sobre:

| Capa | Tecnología |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| UI | React 19 |
| ORM | Prisma 7 (con driver adapter `@prisma/adapter-pg`) |
| Base de datos | PostgreSQL |
| Sesiones | JWT stateless (`jose`) en cookie `httpOnly` |
| Drag & drop | `@dnd-kit` + `fractional-indexing` |

El modelo de ejecución es **servidor por defecto**: páginas, layouts, lecturas de datos
y mutaciones (Server Actions) se ejecutan en el servidor. La interactividad
(arrastrar tarjetas, formularios con feedback en vivo) se concentra en **islas de
cliente** marcadas con `'use client'`. La persistencia es PostgreSQL a través de
Prisma 7.

## Mapa de carpetas

El código de la aplicación vive bajo `app/`. Árbol real:

```
app/
├── layout.tsx                  # Layout raíz
├── page.tsx                    # Entrada: decide setup / login / boards
├── globals.css
├── favicon.ico
├── setup/                      # Wizard de configuración inicial (público)
│   ├── page.tsx
│   └── setup-form.tsx          # 'use client'
├── (auth)/
│   └── login/                  # Grupo de rutas de autenticación (público)
│       ├── page.tsx
│       └── login-form.tsx      # 'use client'
├── (app)/                      # Grupo de rutas autenticadas
│   ├── layout.tsx              # Frontera de seguridad SEGURA (DAL)
│   ├── boards/page.tsx         # Lista de tableros del usuario
│   └── board/[id]/page.tsx     # Un tablero concreto (params asíncronos)
├── api/
│   └── health/route.ts         # Health check (no toca la DB)
├── components/
│   └── board/                  # Islas de cliente del tablero
│       ├── board-view.tsx      # 'use client' — DndContext, estado optimista
│       ├── list-column.tsx
│       ├── card-item.tsx
│       ├── add-list-form.tsx
│       └── add-card-form.tsx
└── lib/
    ├── prisma.ts               # Singleton de PrismaClient (server-only)
    ├── session.ts              # JWT: encrypt/decrypt, crear/borrar cookie
    ├── auth.ts                 # Hash/verificación de contraseña
    ├── dal.ts                  # Data Access Layer (autorización segura)
    ├── ordering.ts             # Helpers de fractional indexing
    ├── queries.ts              # Lecturas (autorización en el WHERE)
    ├── validators.ts           # Esquemas zod compartidos
    ├── types.ts                # DTOs servidor → cliente
    └── actions/                # Server Actions ('use server')
        ├── auth.ts             # login / logout
        ├── setup.ts            # Completar el wizard
        ├── boards.ts           # Crear / renombrar / borrar tablero
        ├── lists.ts            # Listas (columnas)
        └── cards.ts            # Tarjetas (crear, renombrar, borrar, mover)
```

### Rutas

| Ruta | Acceso | Descripción |
| --- | --- | --- |
| `/` | mixto | Punto de entrada; redirige según estado de instancia y sesión |
| `/setup` | público | Wizard de configuración inicial (se bloquea tras completarse) |
| `/login` | público | Inicio de sesión (grupo `(auth)`) |
| `/boards` | autenticado | Tableros del usuario (grupo `(app)`) |
| `/board/[id]` | autenticado | Vista de un tablero con listas y tarjetas |
| `/api/health` | público | Health check para docker-compose |

Los grupos de rutas entre paréntesis — `(auth)` y `(app)` — agrupan páginas sin
añadir segmentos a la URL: sirven para compartir un layout. El layout de `(app)` es la
puerta de entrada al área autenticada.

### Convenciones de Next.js 16

- **`proxy.ts`** (en la raíz del repo) sustituye al antiguo *middleware*. En Next.js 16
  el middleware se llama `proxy` y se ejecuta sobre runtime Node.js. Aquí solo hace un
  chequeo de autenticación **optimista** (ver más abajo).
- **`prisma.config.ts`** (raíz) configura el CLI de Prisma 7: ruta del schema, de las
  migraciones y la `DATABASE_URL` para Migrate. Prisma 7 no carga `.env`
  automáticamente, así que el archivo lo hace a mano con `process.loadEnvFile`.
- **`next.config.ts`** activa `output: "standalone"` para el empaquetado en Docker.

## Frontera servidor/cliente

| Es de servidor | Es isla de cliente (`'use client'`) |
| --- | --- |
| `page.tsx`, `layout.tsx` | `board-view.tsx`, `list-column.tsx`, `card-item.tsx` |
| Lecturas en `lib/queries.ts` | Formularios con `useActionState` (`login-form`, `setup-form`, `add-*-form`) |
| Server Actions en `lib/actions/*` (`'use server'`) | |
| DAL, prisma, session, auth | |

El código sensible (acceso a base de datos, sesiones, secretos) lleva
`import "server-only"` en la primera línea para que el bundler **falle el build** si
alguien lo importa por error desde un componente cliente. Se aplica en
`lib/prisma.ts`, `lib/session.ts`, `lib/dal.ts`, `lib/queries.ts` y `lib/ordering.ts`.

El puente entre ambos mundos son **DTOs serializables mínimos** (`lib/types.ts`):
`board/[id]/page.tsx` lee el tablero completo con Prisma y lo proyecta a `BoardDTO`
(solo `id`, `title`, `position` de listas y tarjetas) antes de pasárselo al componente
cliente `BoardView`. El componente nunca recibe entidades de Prisma completas.

## Flujo de una petición y autorización en capas

La autorización está deliberadamente **en capas**: el `proxy` es rápido pero optimista,
y el `DAL` es la verificación segura real. Una petición a una ruta privada recorre:

```
        Petición HTTP a /board/123
                  │
                  ▼
   ┌───────────────────────────────┐
   │ proxy.ts  (chequeo OPTIMISTA)  │  ¿existe la cookie "session"?
   │ - solo mira si HAY cookie      │  no ─▶ redirect /login
   │ - NO valida criptográficamente │
   └───────────────┬───────────────┘
                   │ sí
                   ▼
   ┌───────────────────────────────┐
   │ app/(app)/layout.tsx (SEGURO) │  isSetupComplete() → si no, /setup
   │ - vía DAL (server-only)        │  requireUser()     → si no, /login
   │ - valida el JWT de verdad      │
   └───────────────┬───────────────┘
                   │ usuario válido
                   ▼
   ┌───────────────────────────────┐
   │ page.tsx  (lectura)            │  requireUser() + queries.ts
   │ - getBoardWithLists(id, userId)│  (autorización en el WHERE)
   │ - proyecta a BoardDTO          │  si no existe/sin acceso → notFound()
   └───────────────┬───────────────┘
                   │ render
                   ▼
   ┌───────────────────────────────┐
   │ Isla cliente: BoardView        │  drag & drop, estado optimista
   └───────────────┬───────────────┘
                   │ el usuario muta algo
                   ▼
   ┌───────────────────────────────┐
   │ Server Action ('use server')   │  1. valida con zod
   │ p. ej. cards.ts:moveCard       │  2. requireBoardAccess(boardId)
   │                                │  3. escribe en Prisma
   │                                │  4. revalidatePath(`/board/${id}`)
   └───────────────────────────────┘
```

### Detalle de cada capa

1. **`proxy.ts` — chequeo optimista.** Comprueba únicamente si la cookie `session`
   existe (`request.cookies.has("session")`). Si no, y la ruta no es pública
   (`/login`, `/setup`), redirige a `/login`. No descifra ni valida el token: solo
   evita renderizar rutas privadas a quien claramente no ha iniciado sesión.

2. **`app/(app)/layout.tsx` — verificación segura.** En cada render llama al DAL:
   `isSetupComplete()` (redirige a `/setup` si la instancia no está configurada) y
   `requireUser()` (redirige a `/login` si el JWT no es válido). Es la frontera de
   seguridad real.

3. **Página — lectura.** `requireUser()` obtiene el usuario y `lib/queries.ts` lee los
   datos. La autorización de lectura está incrustada en el `WHERE` de cada consulta
   (`ownerId` o `members.some`), de modo que un usuario nunca puede leer un tablero del
   que no es dueño ni miembro.

4. **Mutaciones — Server Actions.** Toda escritura es una Server Action (`'use server'`)
   que sigue el mismo patrón: validar la entrada con un esquema **zod**
   (`lib/validators.ts`), autorizar con **`requireBoardAccess(boardId)`** del DAL
   (comprueba la fila en `board_members`), escribir con Prisma y por último
   **`revalidatePath`** para que la UI se refresque. El drag & drop además mantiene
   estado optimista en el cliente y calcula la nueva clave de posición con
   *fractional indexing* (`lib/ordering.ts`), de forma que cada movimiento solo
   actualiza una fila.

Para el detalle del modelo de sesión, hashing y por qué el chequeo está dividido en dos
capas, ver [`docs/authentication.md`](./authentication.md).

## Convenciones de Next.js 16 a tener presentes

Esta versión del framework introduce cambios de ruptura. Puntos clave al contribuir:

- **APIs asíncronas.** `params`, `cookies()` y `headers()` son **asíncronos** y deben
  esperarse con `await`. Por ejemplo, `board/[id]/page.tsx` hace
  `const { id } = await params;`.
- **Mutaciones con Server Actions.** Las escrituras se hacen con Server Actions
  (`'use server'`), no con rutas de API. Los formularios las invocan vía la prop
  `action`; los formularios cliente usan `useActionState` para mostrar errores.
- **`export const dynamic = "force-dynamic"`.** Las páginas y layouts que dependen de la
  base de datos o de la sesión se marcan así para que **no se prerendericen en build**.
  Esto es crítico para el build de Docker, que se ejecuta **sin** base de datos: sin
  esta marca el build intentaría consultar Postgres y fallaría. Lo aplican `page.tsx`
  (raíz), `app/(app)/layout.tsx` y `app/setup/page.tsx`.
- **`output: "standalone"`.** `next.config.ts` genera un servidor Node mínimo en
  `.next/standalone` que se ejecuta con `node server.js`, lo que mantiene pequeña la
  imagen de producción.
- **`proxy.ts` y `prisma.config.ts`** (descritos arriba) son convenciones nuevas de
  esta versión.

Recuerda: la fuente de verdad es la documentación local en
`node_modules/next/dist/docs/`. Consúltala antes de escribir código nuevo, tal como
indica [`AGENTS.md`](../AGENTS.md).

## Datos y despliegue

Para el modelo de datos y las migraciones ver [`docs/database.md`](./database.md); para
el empaquetado en contenedores ver [`docs/docker.md`](./docker.md); y para poner en
marcha una instancia ver [`docs/installation.md`](./installation.md).

---

**Resumen:** orgtable es una app Next.js 16 servidor-por-defecto con islas de cliente,
autorización en capas (proxy optimista → DAL seguro → Server Actions validadas) y
persistencia en PostgreSQL vía Prisma 7.
