"use client";

import { createContext, useContext } from "react";
import type { BoardRole } from "@/app/lib/roles";
import { canEditBoard, canManageBoard } from "@/app/lib/roles";

// Permisos del visor sobre el tablero actual, expuestos por contexto para que los
// componentes cliente (columnas, tarjetas, modal) oculten los controles de escritura
// sin pasar props por todos los niveles. La autorización REAL la hace el servidor en
// cada Server Action; esto es solo UI. Ver app/lib/roles.ts y docs/authorization.md.

export type BoardPerms = {
  role: BoardRole;
  canEdit: boolean; // EDITOR u OWNER: crear/editar/mover contenido.
  canManage: boolean; // OWNER: miembros, etiquetas, renombrar/borrar.
};

const BoardPermsContext = createContext<BoardPerms>({
  role: "VIEWER",
  canEdit: false,
  canManage: false,
});

export function BoardPermsProvider({
  role,
  children,
}: {
  role: BoardRole;
  children: React.ReactNode;
}) {
  const value: BoardPerms = {
    role,
    canEdit: canEditBoard(role),
    canManage: canManageBoard(role),
  };
  return (
    <BoardPermsContext.Provider value={value}>
      {children}
    </BoardPermsContext.Provider>
  );
}

export function useBoardPerms(): BoardPerms {
  return useContext(BoardPermsContext);
}
