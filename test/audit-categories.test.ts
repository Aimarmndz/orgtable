import { describe, it, expect } from "vitest";
import { AUDIT_CATEGORIES, auditCategory, auditCategoryPrefixes } from "@/app/lib/audit-categories";

// The categories of the organization's activity log: the in-memory rule and the SQL
// prefixes must agree, or a filter would hide events of its own category.
const SAMPLES = [
  "workspace.created",
  "workspace.updated",
  "workspace.member_created",
  "workspace.role_updated",
  "workspace.team_board_set",
  "member.added",
  "board.deleted",
  "workspace.webhook_created",
  "workspace.apikey_revoked",
  "workspace.backup_created",
  "workspace.export",
  "workspace.security_updated",
];

describe("audit categories", () => {
  it("puts each action in one category and the SQL prefixes find it there", () => {
    for (const action of SAMPLES) {
      const category = auditCategory(action);
      expect(auditCategoryPrefixes(category).some((p) => action.startsWith(p))).toBe(true);
      for (const other of AUDIT_CATEGORIES.filter((c) => c !== category)) {
        expect(auditCategoryPrefixes(other).some((p) => action.startsWith(p))).toBe(false);
      }
    }
  });
});
