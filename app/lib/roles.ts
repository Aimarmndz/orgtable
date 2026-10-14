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

// --- Workspaces (docs/workspaces.md) ------------------------------------------------------

// The user's role inside a workspace (WorkspaceMember). OWNER > ADMIN > MEMBER.
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

const WORKSPACE_RANK: Record<WorkspaceRole, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

export function atLeastWorkspaceRole(role: WorkspaceRole, min: WorkspaceRole): boolean {
  return WORKSPACE_RANK[role] >= WORKSPACE_RANK[min];
}

/** Can create employees, remove members and manage the organization's boards? */
export function canManageWorkspace(role: WorkspaceRole): boolean {
  return atLeastWorkspaceRole(role, "ADMIN");
}

/** Can rename, delete or transfer the organization and appoint admins? OWNER only. */
export function canOwnWorkspace(role: WorkspaceRole): boolean {
  return role === "OWNER";
}

/**
 * Roles `actor` may give to someone, and the only ones: nobody grants a role above their
 * own, and only an OWNER grants ADMIN or OWNER. This is what stops an ADMIN from making
 * themselves or a friend the OWNER.
 */
export function grantableWorkspaceRoles(actor: WorkspaceRole): WorkspaceRole[] {
  if (actor === "OWNER") return ["OWNER", "ADMIN", "MEMBER"];
  if (actor === "ADMIN") return ["MEMBER"];
  return [];
}

/**
 * Whether `actor` may change or remove a member who currently holds `target`. Owners act on
 * anyone; admins only on plain members (never on other admins or the owners); members on
 * nobody. Acting on oneself is decided by the caller (leaving is allowed, self-promotion
 * is not, and the last owner can never go).
 */
export function canActOnWorkspaceMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target === "MEMBER";
  return false;
}

/**
 * The board role a workspace role grants on that workspace's boards, besides any explicit
 * board membership: owners and admins manage every board of the organization (private
 * ones too: the data belongs to the organization), members edit the boards shared with
 * the whole workspace and see nothing of the private ones.
 */
export function boardRoleFromWorkspace(
  role: WorkspaceRole,
  visibility: "WORKSPACE" | "PRIVATE",
): BoardRole | null {
  if (canManageWorkspace(role)) return "OWNER";
  return visibility === "WORKSPACE" ? "EDITOR" : null;
}

/** The higher of two board roles (either may be missing). */
export function maxBoardRole(a: BoardRole | null, b: BoardRole | null): BoardRole | null {
  if (!a) return b;
  if (!b) return a;
  return BOARD_RANK[a] >= BOARD_RANK[b] ? a : b;
}
