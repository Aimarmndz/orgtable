"use client";

import { createContext, useContext } from "react";
import type { BoardRole } from "@/app/lib/roles";
import { canEditBoard, canManageBoard } from "@/app/lib/roles";

// The viewer's permissions on the current board, exposed through context so Client
// Components (columns, cards, modal) can hide write controls without prop drilling. The
// REAL authorization happens on the server in every Server Action; this is UI only. See
// app/lib/roles.ts and docs/authorization.md.

export type BoardPerms = {
  role: BoardRole;
  canEdit: boolean; // EDITOR or OWNER: create/edit/move content.
  canManage: boolean; // OWNER: members, labels, rename/delete.
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
