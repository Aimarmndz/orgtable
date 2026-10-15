// Categories of the organization's activity log (docs/audit.md), shared by the page, its
// filters and the CSV export. Derived from the action's name, so new actions land in the
// right group as long as they follow the naming (workspace.team_*, workspace.webhook_*…).

export const AUDIT_CATEGORIES = ["organization", "people", "boards", "integrations", "data", "security"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

const RULES: [RegExp, AuditCategory][] = [
  [/^workspace\.(member_|role_|team_)|^member\./, "people"],
  [/^board\./, "boards"],
  [/^workspace\.(webhook_|integration_|incoming_|apikey_)/, "integrations"],
  [/^workspace\.(backup_|export|import|restore)/, "data"],
  [/^workspace\.security_|^auth\.|^account\./, "security"],
];

export function auditCategory(action: string): AuditCategory {
  for (const [re, category] of RULES) if (re.test(action)) return category;
  return "organization";
}

/** The SQL-side filter for a category: the action prefixes that belong to it. */
export function auditCategoryPrefixes(category: AuditCategory): string[] {
  switch (category) {
    case "people":
      return ["workspace.member_", "workspace.role_", "workspace.team_", "member."];
    case "boards":
      return ["board."];
    case "integrations":
      return ["workspace.webhook_", "workspace.integration_", "workspace.incoming_", "workspace.apikey_"];
    case "data":
      return ["workspace.backup_", "workspace.export", "workspace.import", "workspace.restore"];
    case "security":
      return ["workspace.security_", "auth.", "account."];
    case "organization":
      return [
        "workspace.created",
        "workspace.updated",
        "workspace.deleted",
        "workspace.suspended",
        "workspace.unsuspended",
        "workspace.brand_",
      ];
  }
}

export function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORIES as readonly string[]).includes(value);
}
