import { describe, it, expect } from "vitest";
import {
  canEditBoard,
  canManageBoard,
  atLeastBoardRole,
  BOARD_ROLE_LABELS,
  ASSIGNABLE_BOARD_ROLES,
} from "@/app/lib/roles";

// La jerarquía de roles es el corazón de la autorización (ver docs/authorization.md):
// si esto se rompe, la UI o la API podrían conceder de más.
describe("roles", () => {
  it("canEditBoard: EDITOR y OWNER pueden editar; VIEWER no", () => {
    expect(canEditBoard("OWNER")).toBe(true);
    expect(canEditBoard("EDITOR")).toBe(true);
    expect(canEditBoard("VIEWER")).toBe(false);
  });

  it("canManageBoard: solo el OWNER administra", () => {
    expect(canManageBoard("OWNER")).toBe(true);
    expect(canManageBoard("EDITOR")).toBe(false);
    expect(canManageBoard("VIEWER")).toBe(false);
  });

  it("atLeastBoardRole respeta la jerarquía VIEWER < EDITOR < OWNER", () => {
    expect(atLeastBoardRole("OWNER", "EDITOR")).toBe(true);
    expect(atLeastBoardRole("EDITOR", "EDITOR")).toBe(true);
    expect(atLeastBoardRole("EDITOR", "OWNER")).toBe(false);
    expect(atLeastBoardRole("VIEWER", "EDITOR")).toBe(false);
  });

  it("OWNER no es un rol asignable desde la UI", () => {
    expect(ASSIGNABLE_BOARD_ROLES).toEqual(["EDITOR", "VIEWER"]);
    expect(ASSIGNABLE_BOARD_ROLES).not.toContain("OWNER");
    expect(BOARD_ROLE_LABELS.OWNER).toBe("Propietario");
  });
});
