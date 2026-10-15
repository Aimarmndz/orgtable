import { describe, it, expect } from "vitest";
import {
  BASE_ONLY_PERMISSIONS,
  MEMBER_PERMISSIONS,
  PERMISSIONS,
  permissionsOf,
  sanitizeCustomPermissions,
} from "@/app/lib/permissions";

// The permission model of organizations (docs/roles.md).
describe("permissions", () => {
  it("has the thirteen permissions of the design, each once", () => {
    expect(PERMISSIONS).toHaveLength(13);
    expect(new Set(PERMISSIONS).size).toBe(13);
  });

  it("gives owners and admins everything, base-only permissions included", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const perms = permissionsOf(role, []);
      expect([...perms].sort()).toEqual([...PERMISSIONS].sort());
    }
  });

  it("gives a plain member the member defaults", () => {
    expect([...permissionsOf("MEMBER")]).toEqual([...MEMBER_PERMISSIONS]);
    expect([...permissionsOf("MEMBER", null)]).toEqual([...MEMBER_PERMISSIONS]);
  });

  it("gives a member with a custom role exactly that role's permissions", () => {
    const perms = permissionsOf("MEMBER", ["audit.view", "data.export"]);
    expect([...perms]).toEqual(["audit.view", "data.export"]);
    // An empty custom role can do less than a plain member: it may not create boards.
    expect(permissionsOf("MEMBER", []).has("boards.create")).toBe(false);
  });

  it("never lets a custom role hold a base-only permission or an unknown one", () => {
    const clean = sanitizeCustomPermissions(["people.roles", "admin.everything", "people.remove", "people.remove"]);
    expect(clean).toEqual(["people.remove"]);
    for (const p of BASE_ONLY_PERMISSIONS) {
      expect(permissionsOf("MEMBER", [p]).has(p)).toBe(false);
    }
  });
});
