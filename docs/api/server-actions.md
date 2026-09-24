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
indexing*, dentro de una transacción que bloquea la fila padre para que dos altas
simultáneas no repitan posición. Las acciones de drag & drop no calculan la
posición: la reciben ya calculada del cliente y la validan con `isValidPositionKey`
antes de guardarla. Ver [docs/drag-and-drop.md](../drag-and-drop.md#el-servidor-solo-ordena-al-final-y-valida-lo-que-llega).

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
| `reorderList` | `lists.ts` | `({ listId, position })` | `Promise<{ ok: boolean }>` | `reorderListSchema` (`isValidPositionKey`) | `requireBoardAccess` | `revalidatePath` |
| `createCard` | `cards.ts` | `(FormData)` | `Promise<void>` | `cardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `renameCard` | `cards.ts` | `(FormData)` | `Promise<void>` | `cardTitleSchema` | `requireBoardAccess` | `revalidatePath` |
| `deleteCard` | `cards.ts` | `(FormData)` | `Promise<void>` | — | `requireBoardAccess` | `revalidatePath` |
| `moveCard` | `cards.ts` | `({ cardId, toListId, position })` | `Promise<{ ok: boolean }>` | `moveCardSchema` (`isValidPositionKey`) | `requireBoardAccess` | `revalidatePath` |

---

## Setup

### `completeSetup`

**Archivo:** `app/lib/actions/setup.ts` (la transacción vive en
`completeInstanceSetup`, `app/lib/services/setup.ts`)

```ts
export type SetupState = {
  error?: string;
  values?: { instanceName: string; name: string; email: string };
};

export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState>
```

Acción del asistente de configuración inicial (*setup wizard*). Pensada para
`useActionState`, por eso recibe el estado previo `_prev` y devuelve un
`SetupState` con un posible mensaje de error. Los errores devuelven también `values`
(lo tecleado, **nunca** la contraseña) para que el formulario no se vacíe.

- **Corte temprano:** si `isSetupComplete()` ya es cierto, `redirect("/login")` antes
  de validar y de gastar bcrypt (el ID de la acción sigue en el bundle de `/setup` y se
  puede invocar a mano).
- **Valida:** `setupSchema` sobre los campos `instanceName`, `name`, `email` y
  `password`. Si falla, devuelve el primer mensaje de error de zod (o
  `"Datos no válidos."`).
- **Autorización:** no hay sesión todavía. La protección es que el setup solo
  puede completarse **una vez**. La recomprobación de `setupCompletedAt` dentro de la
  transacción **no basta por sí sola** (con READ COMMITTED, dos envíos simultáneos la
  pasarían a la vez): la transacción empieza con un advisory lock que serializa los
  envíos. El porqué está en [`DECISIONES.md`](../DECISIONES.md) («Setup: advisory lock,
  corte temprano y causa en el log»).
- **Base de datos** (`completeInstanceSetup`, todo dentro de `prisma.$transaction`):
  - `pg_advisory_xact_lock(hashtext('orgtable:setup'))`;
  - relee `InstanceConfig` (`id: "singleton"`); si ya hay `setupCompletedAt`, devuelve
    `{ ok: false, reason: "ALREADY_SETUP" }` (no lanza);
  - crea el `User` con `role: "ADMIN"` y la contraseña hasheada
    (`hashPassword`, email normalizado a minúsculas);
  - hace `upsert` de `InstanceConfig` fijando `instanceName` y
    `setupCompletedAt`, y devuelve `{ ok: true, userId }`.
- **Efectos:**
  - `ALREADY_SETUP` → `redirect("/login")`;
  - ante una excepción (BD caída, email duplicado…) registra la causa en el log sin
    FormData ni email (`describeSetupError`) y devuelve
    `{ error: "No se pudo completar la configuración. Inténtalo de nuevo.", values }`;
  - en éxito crea la sesión (`createSession(userId)`), audita `setup.completed` y
    `redirect("/boards")`.

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
export type AuthState = { error?: string; values?: { email: string } };

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState>
```

Inicio de sesión. Diseñada para `useActionState` (recibe `_prev`, devuelve
`AuthState`). Los errores devuelven también `values` (el email tecleado, **nunca** la
contraseña) para repintar el formulario.

- **Límites de intentos:** por IP (solo si hay IP fiable, `TRUSTED_PROXY_HOPS > 0`)
  antes de validar, y por cuenta (email normalizado) antes de verificar; el de cuenta se
  reinicia con un login correcto. Si salta uno, devuelve
  `{ error: "Demasiados intentos. Inténtalo de nuevo en N s.", values }`. Valores y
  porqué en el [ADR 0009](../decisions/0009-in-memory-rate-limit.md).
- **Valida:** `loginSchema` sobre `email` y `password`. Si falla, devuelve
  `{ error: "Revisa el email y la contraseña.", values }`.
- **Autorización:** ninguna previa (es la propia puerta de entrada).
- **Base de datos:** busca el `User` por email (normalizado a minúsculas) y verifica
  la contraseña con `verifyPasswordOrDummy` (`app/lib/auth.ts`): si el usuario no
  existe, compara contra un hash bcrypt ficticio válido del mismo coste, para **no
  filtrar por tiempo** si un email está registrado. Si no hay usuario o la contraseña no
  es válida, devuelve `{ error: "Credenciales incorrectas.", values }`.
- **Efectos:** audita `auth.login_failed` (sin el email tecleado),
  `auth.login_rate_limited` (una vez por ventana bloqueada) o `auth.login`; en éxito,
  `createSession(user.id)` y `redirect("/boards")`.

Paso a paso en [docs/authentication.md](../authentication.md#login).

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
- **Base de datos:** `deleteBoardWithAttachments` (`app/lib/services/attachments.ts`),
  que hace el `board.deleteMany` y, tras el commit, borra los ficheros de los
  adjuntos. Listas y tarjetas se borran en cascada (ver el esquema en
  [docs/database.md](../database.md) y [docs/attachments.md](../attachments.md)).
- **Efectos:** si se borró, `revalidateBoard(boardId)` (avisa a las pestañas
  abiertas); siempre `revalidatePath("/boards")` y `redirect("/boards")`.

---

## Listas

### `createList`

**Archivo:** `app/lib/actions/lists.ts`

```ts
export async function createList(formData: FormData): Promise<void>
```

- **Autorización:** `requireBoardAccess(boardId)`.
- **Valida:** `listTitleSchema` sobre `title`. Si falla, retorna sin hacer nada.
- **Base de datos:** `createListAtEnd` (`app/lib/services/lists.ts`): en una
  transacción bloquea el tablero (`FOR UPDATE`), busca la última lista y crea la
  nueva con `positionAtEnd(last?.position ?? null)` (*fractional indexing*, se añade
  al final).
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
- **Base de datos:** `deleteListWithAttachments` (`app/lib/services/attachments.ts`):
  `list.delete` y, tras el commit, los ficheros de los adjuntos. Las tarjetas de la
  lista se borran en cascada (`onDelete: Cascade` en el esquema, ver
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
- **Valida:** `reorderListSchema` (zod) antes de cualquier consulta. La nueva clave
  de posición la **calcula el cliente** (*fractional indexing*) y el servidor la
  valida con `isValidPositionKey`; una clave inválida devuelve `{ ok: false }` y no
  se guarda. La regla está en
  [docs/drag-and-drop.md](../drag-and-drop.md#validación-de-la-clave-isvalidpositionkey).
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
- **Base de datos:** `createCardAtEnd` (`app/lib/services/cards.ts`): en una
  transacción bloquea la lista (`FOR UPDATE`), busca la última tarjeta y crea la
  nueva con `positionAtEnd(last?.position ?? null)` (*fractional indexing*, al final
  de la lista).
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
- **Base de datos:** `deleteCardWithAttachments` (`app/lib/services/attachments.ts`):
  `card.delete` y, tras el commit, los ficheros de los adjuntos.
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
- **Valida:** `moveCardSchema` (zod) antes de cualquier consulta. La nueva clave de
  posición la **calcula el cliente** (*fractional indexing*) y el servidor la valida
  con `isValidPositionKey`; una clave inválida devuelve `{ ok: false }` y no se
  guarda. La regla está en
  [docs/drag-and-drop.md](../drag-and-drop.md#validación-de-la-clave-isvalidpositionkey).
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
  cuenta. Retorno: `{ error?, field?, message?, values? }` para `useActionState`;
  `field` (`"email"`) marca el campo del error y `values` (`{ name, email, role }`,
  **nunca** la contraseña) solo viene con `error`, para que el formulario no se vacíe.
- **`updateUserRole(formData)`** — `{ userId, role }`. Cambia el rol global. No puedes
  cambiar tu propio rol. Devuelve el resultado vía redirección con query.
- **`resetUserPassword(formData)`** — `{ userId, password }`. Restablece la
  contraseña y, en la misma transacción (`resetPasswordAndRevokeAccess`), revoca todas
  las sesiones del usuario y **borra sus tokens de API** (ver
  [docs/admin.md](../admin.md)). Vía redirección con query.
- **`revokeUserSessions(formData)`** — `{ userId }`. Cierra todas las sesiones activas
  del usuario al instante; los tokens de API siguen vigentes. Vía redirección con
  query.
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
