# Referencia de Server Actions

Este documento cataloga **todas** las Server Actions del proyecto orgtable
(Next.js 16 + Prisma 7). Está pensado como referencia para contribuidores: para
cada acción se documenta su firma, qué valida, qué autorización aplica, qué hace
en la base de datos y qué efectos secundarios produce (`revalidatePath`,
`redirect`).

Todas las acciones viven en `app/lib/actions/` y comienzan con la directiva
`"use server"`.

## Patrón común

La mayoría de las acciones siguen siempre el mismo flujo de cuatro pasos:

1. **Validar** la entrada con un esquema [zod](https://zod.dev) de
   `app/lib/validators.ts`.
2. **Autorizar** mediante el Data Access Layer (`app/lib/dal.ts`): `requireUser`
   (exige sesión) o `requireBoardAccess` (exige ser miembro del tablero). Algunas
   acciones aplican una comprobación de **solo dueño** directamente en la query.
3. **Mutar** la base de datos con Prisma.
4. **Revalidar** la caché de la ruta afectada con `revalidatePath` y, cuando
   procede, **redirigir** con `redirect`.

> Nota sobre el orden validar/autorizar: en varias acciones la autorización
> ocurre **antes** de validar el cuerpo (p. ej. `createBoard`, `createList`),
> porque primero hay que resolver a qué tablero pertenece la mutación. El
> principio es el mismo: nunca se toca la base de datos sin haber autorizado.

### Dos estilos de invocación

| Estilo | Acciones | Entrada | Retorno | Efectos |
| --- | --- | --- | --- | --- |
| **Formulario** (`<form action={...}>`) | `completeSetup`, `login`, `logout`, `createBoard`, `renameBoard`, `deleteBoard`, `createList`, `renameList`, `deleteList`, `createCard`, `renameCard`, `deleteCard` | `FormData` (a veces precedido de `_prev` para `useActionState`) | `void` o `{ error?: string }` | `revalidatePath` y/o `redirect` |
| **Drag & drop** (llamada imperativa desde el cliente) | `reorderList`, `moveCard` | Un **objeto** tipado | `{ ok: boolean }` | `revalidatePath`, sin `redirect` |

Las acciones de formulario reciben `FormData` y normalmente terminan
redirigiendo o revalidando una ruta para que el servidor vuelva a renderizar. Las
acciones de drag & drop reciben un objeto plano (el cliente ya calculó la nueva
posición), actualizan **una única fila** y devuelven `{ ok: boolean }` para que
la UI pueda revertir el movimiento optimista si algo falla. Ver
[docs/drag-and-drop.md](../drag-and-drop.md).

### Posicionamiento (fractional indexing)

Las acciones que **crean** elementos (`createList`, `createCard`) calculan la
posición del nuevo elemento con `positionAtEnd` de `app/lib/ordering.ts`, que
genera una clave lexicográfica al final de la lista mediante *fractional
indexing*. Las acciones de drag & drop no calculan la posición: la recibe ya
calculada del cliente. Ver [docs/drag-and-drop.md](../drag-and-drop.md).

---

## Tabla resumen

| Acción | Archivo | Entrada | Retorno | Valida (zod) | Autorización | Efectos |
| --- | --- | --- | --- | --- | --- | --- |
| `completeSetup` | `setup.ts` | `(_prev, FormData)` | `Promise<SetupState>` | `setupSchema` | Ninguna (solo si el setup no está hecho) | `createSession`, `redirect` |
| `login` | `auth.ts` | `(_prev, FormData)` | `Promise<AuthState>` | `loginSchema` | Ninguna (es el login) | `createSession`, `redirect` |
| `logout` | `auth.ts` | `()` | `Promise<void>` | — | — | `deleteSession`, `redirect` |
| `createBoard` | `boards.ts` | `(FormData)` | `Promise<void>` | `boardTitleSchema` | `requireUser` | `revalidatePath`, `redirect` |
| `renameBoard` | `boards.ts` | `(FormData)` | `Promise<void>` | `boardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `deleteBoard` | `boards.ts` | `(FormData)` | `Promise<void>` | — | `requireUser` + solo dueño | `revalidatePath`, `redirect` |
| `createList` | `lists.ts` | `(FormData)` | `Promise<void>` | `listTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `renameList` | `lists.ts` | `(FormData)` | `Promise<void>` | `listTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `deleteList` | `lists.ts` | `(FormData)` | `Promise<void>` | — | `requireBoardAccess` | `revalidatePath` |
| `reorderList` | `lists.ts` | `({ listId, position })` | `Promise<{ ok: boolean }>` | — | `requireBoardAccess` | `revalidatePath` |
| `createCard` | `cards.ts` | `(FormData)` | `Promise<void>` | `cardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `renameCard` | `cards.ts` | `(FormData)` | `Promise<void>` | `cardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `deleteCard` | `cards.ts` | `(FormData)` | `Promise<void>` | — | `requireBoardAccess` | `revalidatePath` |
| `moveCard` | `cards.ts` | `({ cardId, toListId, position })` | `Promise<{ ok: boolean }>` | — | `requireBoardAccess` | `revalidatePath` |

---

## Setup

### `completeSetup`

**Archivo:** `app/lib/actions/setup.ts`

```ts
export type SetupState = { error?: string };

export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState>
```

Acción del asistente de configuración inicial (*setup wizard*). Pensada para
`useActionState`, por eso recibe el estado previo `_prev` y devuelve un
`SetupState` con un posible mensaje de error.

- **Valida:** `setupSchema` sobre los campos `instanceName`, `name`, `email` y
  `password`. Si falla, devuelve el primer mensaje de error de zod (o
  `"Datos no válidos."`).
- **Autorización:** no hay sesión todavía. La protección es que el setup solo
  puede completarse **una vez**: dentro de una transacción Prisma se vuelve a
  comprobar que `instanceConfig.setupCompletedAt` no esté ya fijado, lo que lo
  hace atómico frente a un doble envío del formulario.
- **Base de datos** (todo dentro de `prisma.$transaction`):
  - relee `InstanceConfig` (`id: "singleton"`); si ya hay `setupCompletedAt`,
    lanza `ALREADY_SETUP`;
  - crea el `User` con `role: "ADMIN"` y la contraseña hasheada
    (`hashPassword`, email normalizado a minúsculas);
  - hace `upsert` de `InstanceConfig` fijando `instanceName` y
    `setupCompletedAt`.
- **Efectos:**
  - si la instancia ya estaba configurada (`ALREADY_SETUP`) → `redirect("/login")`;
  - ante otro error devuelve `{ error: "No se pudo completar la configuración..." }`;
  - en éxito crea la sesión (`createSession(userId)`) y `redirect("/boards")`.

> Detalle de implementación: `redirect()` se llama **fuera** del `try/catch`,
> porque internamente lanza la excepción `NEXT_REDIRECT` de Next que no debe ser
> capturada por el `catch` de la transacción.

Ver [docs/authentication.md](../authentication.md) y
[docs/database.md](../database.md).

---

## Auth

### `login`

**Archivo:** `app/lib/actions/auth.ts`

```ts
export type AuthState = { error?: string };

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState>
```

Inicio de sesión. Diseñada para `useActionState` (recibe `_prev`, devuelve
`AuthState`).

- **Valida:** `loginSchema` sobre `email` y `password`. Si falla, devuelve
  `{ error: "Revisa el email y la contraseña." }`.
- **Autorización:** ninguna previa (es la propia puerta de entrada).
- **Base de datos:** busca el `User` por email (normalizado a minúsculas) y
  verifica la contraseña con `verifyPassword`. Para **no filtrar por tiempo** si
  un email está o no registrado, siempre se ejecuta la verificación: si el
  usuario no existe se usa un hash ficticio. Si no hay usuario o la contraseña no
  es válida, devuelve `{ error: "Credenciales incorrectas." }`.
- **Efectos:** en éxito, `createSession(user.id)` y `redirect("/boards")`.

Ver [docs/authentication.md](../authentication.md).

### `logout`

**Archivo:** `app/lib/actions/auth.ts`

```ts
export async function logout(): Promise<void>
```

Cierra la sesión. No recibe parámetros.

- **Valida:** nada.
- **Autorización:** ninguna (cerrar sesión es seguro siempre).
- **Base de datos:** ninguna mutación de datos de dominio; `deleteSession`
  elimina la cookie de sesión.
- **Efectos:** `deleteSession()` y `redirect("/login")`.

Ver [docs/authentication.md](../authentication.md).

---

## Tableros

### `createBoard`

**Archivo:** `app/lib/actions/boards.ts`

```ts
export async function createBoard(formData: FormData): Promise<void>
```

- **Autorización:** `requireUser()` (exige sesión válida; si no, redirige a
  `/login`).
- **Valida:** `boardTitleSchema` sobre el campo `title`. Si falla, **retorna sin
  hacer nada** (no muestra error).
- **Base de datos:** crea el `Board` con `ownerId = user.id` y, en la misma
  operación anidada, un `BoardMember` con `role: "OWNER"`. El creador queda como
  dueño y, a la vez, como miembro del tablero — la autorización siempre se
  comprueba contra `board_members`.
- **Efectos:** `revalidatePath("/boards")` y `redirect(\`/board/${board.id}\`)`.

### `renameBoard`

**Archivo:** `app/lib/actions/boards.ts`

```ts
export async function renameBoard(formData: FormData): Promise<void>
```

- **Autorización:** `requireBoardAccess(boardId)` (exige ser miembro del tablero;
  si no, redirige a `/boards`).
- **Valida:** `boardTitleSchema` sobre `title`. Si falla, retorna sin hacer nada.
- **Base de datos:** `board.update` cambiando el `title`.
- **Efectos:** `revalidatePath(\`/board/${boardId}\`)`. Sin redirect.

### `deleteBoard`

**Archivo:** `app/lib/actions/boards.ts`

```ts
export async function deleteBoard(formData: FormData): Promise<void>
```

- **Autorización:** `requireUser()` **+ solo dueño**. A diferencia de las demás,
  no usa `requireBoardAccess`: usa `board.deleteMany({ where: { id, ownerId:
  user.id } })`, que solo borra si el usuario es el dueño y **no falla** si no
  coincide (no hay error visible para no-dueños).
- **Valida:** nada.
- **Base de datos:** `board.deleteMany`. Listas y tarjetas se borran en cascada
  (ver el esquema en [docs/database.md](../database.md)).
- **Efectos:** `revalidatePath("/boards")` y `redirect("/boards")`.

---

## Listas

### `createList`

**Archivo:** `app/lib/actions/lists.ts`

```ts
export async function createList(formData: FormData): Promise<void>
```

- **Autorización:** `requireBoardAccess(boardId)`.
- **Valida:** `listTitleSchema` sobre `title`. Si falla, retorna sin hacer nada.
- **Base de datos:** busca la última lista del tablero (`orderBy position desc`)
  y crea la nueva lista con `position: positionAtEnd(last?.position ?? null)`
  (*fractional indexing*, se añade al final).
- **Efectos:** `revalidatePath(\`/board/${boardId}\`)`.

### `renameList`

**Archivo:** `app/lib/actions/lists.ts`

```ts
export async function renameList(formData: FormData): Promise<void>
```

- **Autorización:** primero resuelve el `boardId` de la lista
  (`list.findUnique`); si la lista no existe, retorna. Luego
  `requireBoardAccess(list.boardId)`.
- **Valida:** `listTitleSchema` sobre `title`. Si falla, retorna sin hacer nada.
- **Base de datos:** `list.update` cambiando el `title`.
- **Efectos:** `revalidatePath(\`/board/${list.boardId}\`)`.

### `deleteList`

**Archivo:** `app/lib/actions/lists.ts`

```ts
export async function deleteList(formData: FormData): Promise<void>
```

- **Autorización:** resuelve `boardId` de la lista; si no existe, retorna. Luego
  `requireBoardAccess(list.boardId)`.
- **Valida:** nada.
- **Base de datos:** `list.delete`. Las tarjetas de la lista se borran en cascada
  (`onDelete: Cascade` en el esquema, ver
  [docs/database.md](../database.md)).
- **Efectos:** `revalidatePath(\`/board/${list.boardId}\`)`.

### `reorderList`

**Archivo:** `app/lib/actions/lists.ts`

```ts
export async function reorderList(input: {
  listId: string;
  position: string;
}): Promise<{ ok: boolean }>
```

Acción de **drag & drop**: persiste el reordenamiento de una lista. Recibe un
objeto (no `FormData`) y devuelve `{ ok: boolean }`.

- **Autorización:** resuelve `boardId` de la lista; si no existe, devuelve
  `{ ok: false }`. Luego `requireBoardAccess(list.boardId)`.
- **Valida:** no usa zod. La nueva clave de posición la **calcula el cliente**
  (*fractional indexing*) y aquí solo se persiste.
- **Base de datos:** `list.update` actualizando únicamente `position` de **una
  sola fila**.
- **Efectos:** `revalidatePath(\`/board/${list.boardId}\`)`; devuelve
  `{ ok: true }`. Sin redirect.

Ver [docs/drag-and-drop.md](../drag-and-drop.md).

---

## Tarjetas

> Helper interno `boardIdForList(listId)`: dado un `listId`, devuelve el
> `boardId` al que pertenece (para autorizar y revalidar), o `null` si la lista
> no existe.

### `createCard`

**Archivo:** `app/lib/actions/cards.ts`

```ts
export async function createCard(formData: FormData): Promise<void>
```

- **Autorización:** obtiene `boardId` vía `boardIdForList(listId)`; si es `null`,
  retorna. Luego `requireBoardAccess(boardId)`.
- **Valida:** `cardTitleSchema` sobre `title`. Si falla, retorna sin hacer nada.
- **Base de datos:** busca la última tarjeta de la lista (`orderBy position
  desc`) y crea la nueva con `position: positionAtEnd(last?.position ?? null)`
  (*fractional indexing*, al final de la lista).
- **Efectos:** `revalidatePath(\`/board/${boardId}\`)`.

### `renameCard`

**Archivo:** `app/lib/actions/cards.ts`

```ts
export async function renameCard(formData: FormData): Promise<void>
```

- **Autorización:** busca la tarjeta seleccionando `list.boardId`; si no existe,
  retorna. Luego `requireBoardAccess(card.list.boardId)`.
- **Valida:** `cardTitleSchema` sobre `title`. Si falla, retorna sin hacer nada.
- **Base de datos:** `card.update` cambiando el `title`.
- **Efectos:** `revalidatePath(\`/board/${card.list.boardId}\`)`.

### `deleteCard`

**Archivo:** `app/lib/actions/cards.ts`

```ts
export async function deleteCard(formData: FormData): Promise<void>
```

- **Autorización:** busca la tarjeta seleccionando `list.boardId`; si no existe,
  retorna. Luego `requireBoardAccess(card.list.boardId)`.
- **Valida:** nada.
- **Base de datos:** `card.delete`.
- **Efectos:** `revalidatePath(\`/board/${card.list.boardId}\`)`.

### `moveCard`

**Archivo:** `app/lib/actions/cards.ts`

```ts
export async function moveCard(input: {
  cardId: string;
  toListId: string;
  position: string;
}): Promise<{ ok: boolean }>
```

Acción de **drag & drop**: mueve una tarjeta, que puede cambiar de lista y/o de
posición. Recibe un objeto (no `FormData`) y devuelve `{ ok: boolean }`.

- **Autorización:** obtiene `boardId` de la lista destino vía
  `boardIdForList(input.toListId)`; si es `null`, devuelve `{ ok: false }`. Luego
  `requireBoardAccess(boardId)`.
- **Valida:** no usa zod. La nueva clave de posición la **calcula el cliente**
  (*fractional indexing*).
- **Base de datos:** un único `card.update` que fija `listId: toListId` y
  `position`.
- **Efectos:** `revalidatePath(\`/board/${boardId}\`)`; devuelve `{ ok: true }`.
  Sin redirect.

Ver [docs/drag-and-drop.md](../drag-and-drop.md).

---

## Multiusuario (Hito 3)

Toda mutación que ya pasaba por `requireBoardAccess` ahora **comprueba además el
rol** con los ayudantes de `app/lib/roles.ts` (`canEditBoard`, `canManageBoard`).
Si el rol no alcanza, la acción no hace nada (formularios) o devuelve `{ ok: false }`
(drag & drop). Ver [docs/authorization.md](../authorization.md).

### Miembros de tablero — `app/lib/actions/members.ts`

Solo el **propietario** (`OWNER`) del tablero.

- **`addBoardMember(_prev, formData)`** — `{ boardId, email, role }`. Valida con
  `addMemberSchema`. Busca un usuario existente por email; si no existe, devuelve un
  error. Crea la fila en `board_members`. Retorno: `{ error?, message?, values? }` para
  `useActionState`; `values` (`{ email, role }` enviados) solo viene con `error`, para
  que el formulario no se vacíe al fallar.
- **`updateBoardMemberRole(formData)`** — `{ boardId, userId, role }`. Cambia el rol
  de un miembro. No permite tocar el rol del dueño del tablero. Si el usuario no es
  miembro o ya tenía ese rol, no hace nada (ni auditoría ni notificación).
- **`removeBoardMember(formData)`** — `{ boardId, userId }`. Quita a un miembro y sus
  asignaciones en las tarjetas del tablero (`removeMemberFromBoard`, una transacción). No
  permite quitar al dueño. Si el usuario no era miembro, no audita ni notifica.

Las tres llaman a `revalidateBoard(boardId)`, así que los demás miembros conectados ven
el cambio en vivo.

### Administración de usuarios — `app/lib/actions/admin.ts`

Solo el **administrador global** (`requireAdmin`).

- **`createUser(_prev, formData)`** — `{ name, email, password, role }`. Valida con
  `createUserSchema`, comprueba unicidad del email, hashea la contraseña y crea la
  cuenta. Retorno: `{ error?, message? }`.
- **`updateUserRole(formData)`** — `{ userId, role }`. Cambia el rol global. No puedes
  cambiar tu propio rol. Devuelve el resultado vía redirección con query.
- **`resetUserPassword(formData)`** — `{ userId, password }`. Restablece la
  contraseña. Vía redirección con query.
- **`deleteUser(formData)`** — `{ userId }`. Borra la cuenta. No puedes borrarte a ti
  mismo ni borrar a un usuario que es propietario de tableros (cascada). Vía
  redirección con query.

---

## Véase también

- [docs/authentication.md](../authentication.md) — sesiones, `requireUser`,
  `requireBoardAccess` y el Data Access Layer.
- [docs/authorization.md](../authorization.md) — modelo de roles y dónde se aplica.
- [docs/drag-and-drop.md](../drag-and-drop.md) — reordenamiento optimista y
  *fractional indexing* en el cliente.
- [docs/database.md](../database.md) — esquema Prisma, relaciones y borrado en
  cascada.

---

En resumen: cada Server Action sigue el patrón validar → autorizar → mutar →
revalidar, con dos variantes — las de formulario que reciben `FormData` y suelen
redirigir, y las de drag & drop (`reorderList`, `moveCard`) que reciben un objeto
y devuelven `{ ok: boolean }`.
