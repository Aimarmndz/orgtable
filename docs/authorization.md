# Autorización y roles (multiusuario)

orgtable tiene **dos niveles de roles**, independientes entre sí:

- **Rol global** (`User.role`): `ADMIN` o `MEMBER`. Decide quién administra la
  instancia (crear cuentas, cambiar roles, restablecer contraseñas, borrar usuarios).
- **Rol de tablero** (`BoardMember.role`): `OWNER`, `EDITOR` o `VIEWER`. Decide qué
  puede hacer cada persona **dentro de un tablero concreto**.

Ambos modelos existían en el esquema desde el Hito 0 (ver `docs/database.md`); el
Hito 3 los pone en uso.

## Jerarquía de roles de tablero

```
VIEWER  <  EDITOR  <  OWNER
```

| Acción | VIEWER | EDITOR | OWNER |
| --- | :---: | :---: | :---: |
| Ver el tablero, listas y tarjetas | ✅ | ✅ | ✅ |
| Crear/editar/mover listas, tarjetas y checklists | — | ✅ | ✅ |
| Asignar etiquetas existentes a tarjetas | — | ✅ | ✅ |
| Crear/borrar etiquetas del tablero | — | — | ✅ |
| Renombrar el tablero | — | — | ✅ |
| Invitar/quitar miembros y cambiar sus roles | — | — | ✅ |
| Borrar el tablero | — | — | ✅ (solo el dueño) |

El **propietario** de un tablero es su creador (`Board.ownerId`), que además es
miembro con rol `OWNER`. Su rol no se puede cambiar ni se le puede quitar del
tablero: es el ancla de la propiedad.

Los ayudantes que codifican esta jerarquía viven en
[`app/lib/roles.ts`](../app/lib/roles.ts):

```ts
canEditBoard(role)    // EDITOR u OWNER → puede editar contenido
canManageBoard(role)  // solo OWNER → puede administrar el tablero
```

Este módulo **no** lleva `server-only` a propósito: también lo importan los
componentes cliente para ocultar los controles que el usuario no puede usar.

## Dónde se aplica la autorización

La regla de oro: **el servidor es la única autoridad**. La interfaz oculta botones
por comodidad, pero nunca es la barrera de seguridad.

### 1. Data Access Layer (`app/lib/dal.ts`)

- `requireUser()` — exige sesión válida (si no, redirige a `/login`).
- `requireAdmin()` — exige `User.role === "ADMIN"` (si no, redirige a `/boards`).
- `requireBoardAccess(boardId)` — exige ser miembro del tablero (si no, redirige a
  `/boards`) y **devuelve el rol** del usuario en ese tablero.

### 2. Cada Server Action

Tras `requireBoardAccess`, la acción comprueba el rol con los ayudantes de
`roles.ts` y, si no alcanza, **no hace nada** (acciones de formulario) o devuelve
`{ ok: false }` (acciones de drag & drop / imperativas):

```ts
export async function createList(formData: FormData) {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return; // backstop de seguridad
  // …
}
```

### 3. La interfaz (defensa en profundidad)

El componente de tablero recibe el rol del visor y lo expone por contexto
([`board-perms.tsx`](../app/components/board/board-perms.tsx)). Con `canEdit` y
`canManage` los componentes ocultan: arrastrar y soltar, los formularios de añadir,
los botones de borrar, la edición en el modal de tarjeta y el panel de gestión de
miembros. Un `VIEWER` ve un tablero **de solo lectura**.

## Por qué guardas explícitas y no `forbidden()`

Next.js 16 ofrece `forbidden()`/`unauthorized()` para cortar la ejecución con una
página 403/401, pero son **experimentales** (requieren `experimental.authInterrupts`).
orgtable prefiere **guardas explícitas** (`if (!canEditBoard(role)) return;`) por
tres motivos: no dependen de una API experimental, encajan con el estilo existente
de "fallar en silencio" de las acciones, y permiten que las acciones de drag & drop
devuelvan `{ ok: false }` para que el cliente revierta su UI optimista sin lanzar una
excepción. La decisión está registrada en
[ADR 0006](./decisions/0006-rbac-explicit-guards.md).

## Invitar miembros

No hay registro abierto: solo se puede invitar a **usuarios que ya existen**. El
flujo es:

1. El administrador da de alta las cuentas en `/admin/users` (ver
   [`docs/admin.md`](./admin.md)).
2. El propietario de un tablero abre **Miembros**, escribe el email de una persona
   existente y elige su rol (`EDITOR` o `VIEWER`).

Si el email no corresponde a ninguna cuenta, la invitación se rechaza con un mensaje
que pide al administrador crear la cuenta primero. Así evitamos correos de
invitación, tokens y verificación en una app self-hosted de equipo pequeño.
