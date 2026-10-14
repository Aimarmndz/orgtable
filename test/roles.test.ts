import { describe, it, expect } from "vitest";
import {
  canEditBoard,
  canManageBoard,
  atLeastBoardRole,
  ASSIGNABLE_BOARD_ROLES,
} from "@/app/lib/roles";
import { messagesFor } from "@/app/i18n/config";

// The role hierarchy is the heart of authorization (see docs/authorization.md):
// if this breaks, the UI or the API could grant too much.
describe("roles", () => {
  it("canEditBoard: EDITOR and OWNER can edit; VIEWER cannot", () => {
    expect(canEditBoard("OWNER")).toBe(true);
    expect(canEditBoard("EDITOR")).toBe(true);
    expect(canEditBoard("VIEWER")).toBe(false);
  });

  it("canManageBoard: only the OWNER administers", () => {
    expect(canManageBoard("OWNER")).toBe(true);
    expect(canManageBoard("EDITOR")).toBe(false);
    expect(canManageBoard("VIEWER")).toBe(false);
  });

  it("atLeastBoardRole follows the hierarchy VIEWER < EDITOR < OWNER", () => {
    expect(atLeastBoardRole("OWNER", "EDITOR")).toBe(true);
    expect(atLeastBoardRole("EDITOR", "EDITOR")).toBe(true);
    expect(atLeastBoardRole("EDITOR", "OWNER")).toBe(false);
    expect(atLeastBoardRole("VIEWER", "EDITOR")).toBe(false);
  });

  it("OWNER is not a role that can be assigned from the UI", () => {
    expect(ASSIGNABLE_BOARD_ROLES).toEqual(["EDITOR", "VIEWER"]);
    expect(ASSIGNABLE_BOARD_ROLES).not.toContain("OWNER");
  });

  it("every board role has a visible name in each language (m.boards.roles)", () => {
    // The labels moved from roles.ts to locales/*/boards.json.
    expect(messagesFor("en").boards.roles).toEqual({
      OWNER: "Owner",
      EDITOR: "Editor",
      VIEWER: "Viewer",
    });
    expect(messagesFor("es").boards.roles.OWNER).toBe("Propietario");
  });
});

describe("workspace roles (no escalation)", () => {
  it("only an owner grants ADMIN or OWNER; an admin grants MEMBER; a member nothing", async () => {
    const { grantableWorkspaceRoles } = await import("@/app/lib/roles");
    expect(grantableWorkspaceRoles("OWNER")).toEqual(["OWNER", "ADMIN", "MEMBER"]);
    expect(grantableWorkspaceRoles("ADMIN")).toEqual(["MEMBER"]);
    expect(grantableWorkspaceRoles("MEMBER")).toEqual([]);
  });

  it("an admin acts only on members; owners on anyone; members on nobody", async () => {
    const { canActOnWorkspaceMember } = await import("@/app/lib/roles");
    expect(canActOnWorkspaceMember("ADMIN", "MEMBER")).toBe(true);
    expect(canActOnWorkspaceMember("ADMIN", "ADMIN")).toBe(false);
    expect(canActOnWorkspaceMember("ADMIN", "OWNER")).toBe(false);
    expect(canActOnWorkspaceMember("OWNER", "OWNER")).toBe(true);
    expect(canActOnWorkspaceMember("MEMBER", "MEMBER")).toBe(false);
  });

  it("the board role a workspace role gives", async () => {
    const { boardRoleFromWorkspace, maxBoardRole } = await import("@/app/lib/roles");
    expect(boardRoleFromWorkspace("OWNER", "PRIVATE")).toBe("OWNER");
    expect(boardRoleFromWorkspace("ADMIN", "WORKSPACE")).toBe("OWNER");
    expect(boardRoleFromWorkspace("MEMBER", "WORKSPACE")).toBe("EDITOR");
    expect(boardRoleFromWorkspace("MEMBER", "PRIVATE")).toBeNull();
    expect(maxBoardRole("VIEWER", "EDITOR")).toBe("EDITOR");
    expect(maxBoardRole(null, "VIEWER")).toBe("VIEWER");
    expect(maxBoardRole(null, null)).toBeNull();
  });
});
