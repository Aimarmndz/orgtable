// Modelo de roles y permisos, compartido entre servidor y cliente (NO lleva
// "server-only" a propósito: los componentes cliente lo importan para ocultar los
// controles de escritura a quien no puede usarlos). La autorización REAL vive en el
// servidor (cada Server Action vuelve a comprobar el rol); esto es solo para la UI y
// para no duplicar la jerarquía de roles. Ver docs/authorization.md.

// Rol del usuario DENTRO de un tablero concreto (tabla board_members).
export type BoardRole = "OWNER" | "EDITOR" | "VIEWER";

// Rol GLOBAL del usuario en la instancia (tabla users).
export type GlobalRole = "ADMIN" | "MEMBER";

// Jerarquía: VIEWER < EDITOR < OWNER. Un rol "incluye" a todos los de menor rango.
const BOARD_RANK: Record<BoardRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};

/** true si `role` tiene al menos el rango de `min`. */
export function atLeastBoardRole(role: BoardRole, min: BoardRole): boolean {
  return BOARD_RANK[role] >= BOARD_RANK[min];
}

/** ¿Puede crear/editar/mover contenido (listas, tarjetas, checklists)? EDITOR u OWNER. */
export function canEditBoard(role: BoardRole): boolean {
  return atLeastBoardRole(role, "EDITOR");
}

/** ¿Puede administrar el tablero (miembros, etiquetas, renombrar, borrar)? Solo OWNER. */
export function canManageBoard(role: BoardRole): boolean {
  return role === "OWNER";
}

// Etiquetas legibles para la interfaz (en español, como el resto de la UI).
export const BOARD_ROLE_LABELS: Record<BoardRole, string> = {
  OWNER: "Propietario",
  EDITOR: "Editor",
  VIEWER: "Lector",
};

export const BOARD_ROLE_HINTS: Record<BoardRole, string> = {
  OWNER: "Control total: contenido, miembros, etiquetas y borrar el tablero.",
  EDITOR: "Puede crear y editar listas, tarjetas y checklists.",
  VIEWER: "Solo lectura: ve el tablero pero no puede modificarlo.",
};

// Roles que un propietario puede asignar al invitar/editar miembros (no se asigna
// OWNER desde la UI: el propietario es el creador del tablero).
export const ASSIGNABLE_BOARD_ROLES: BoardRole[] = ["EDITOR", "VIEWER"];
