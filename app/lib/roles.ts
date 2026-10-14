// Role and permission model, shared by server and client (deliberately NOT
// "server-only": Client Components import it to hide write controls from people who
// cannot use them). The REAL authorization lives on the server (every Server Action
// checks the role again); this is only for the UI and to avoid duplicating the role
// hierarchy. See docs/authorization.md.
//
// Role names shown in the UI live in the messages: `m.boards.roles[role]`.

// The user's role WITHIN a given board (board_members table).
export type BoardRole = "OWNER" | "EDITOR" | "VIEWER";

// The user's GLOBAL role in the instance (users table).
export type GlobalRole = "ADMIN" | "MEMBER";

// Hierarchy: VIEWER < EDITOR < OWNER. A role "includes" every lower-ranked one.
const BOARD_RANK: Record<BoardRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};

/** true if `role` ranks at least as high as `min`. */
export function atLeastBoardRole(role: BoardRole, min: BoardRole): boolean {
  return BOARD_RANK[role] >= BOARD_RANK[min];
}

/** Can create/edit/move content (lists, cards, checklists)? EDITOR or OWNER. */
export function canEditBoard(role: BoardRole): boolean {
  return atLeastBoardRole(role, "EDITOR");
}

/** Can administer the board (members, labels, rename, delete)? OWNER only. */
export function canManageBoard(role: BoardRole): boolean {
  return role === "OWNER";
}

// Roles an owner can grant when inviting or editing members (OWNER is never granted
// from the UI: the owner is whoever created the board).
export const ASSIGNABLE_BOARD_ROLES: BoardRole[] = ["EDITOR", "VIEWER"];
