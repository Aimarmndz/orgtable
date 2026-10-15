import { orgAccessFromSession } from "@/app/lib/org-settings";
import { listOrgAudit, readableDetails } from "@/app/lib/services/org-audit";
import { auditCategory, isAuditCategory } from "@/app/lib/audit-categories";
import { recordAudit } from "@/app/lib/audit";
import { getI18n } from "@/app/i18n/server";

// GET /api/workspaces/<slug>/audit: the organization's activity log as CSV (docs/audit.md),
// with the same filters as the page (?category=, ?person=). Browser session and
// "audit.view" only; anything else is the same 404. At most 10 000 rows.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ROWS = 10_000;

/** A CSV field: quoted, and neutralised if a spreadsheet would read it as a formula. */
function csv(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await orgAccessFromSession(slug, "audit.view");
  if (!access) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? "";
  const person = url.searchParams.get("person") ?? "";
  const { rows } = await listOrgAudit(
    access.workspace.id,
    { category: isAuditCategory(category) ? category : undefined, userId: person || undefined },
    MAX_ROWS,
  );
  const [{ m }, details] = await Promise.all([
    getI18n(),
    readableDetails(
      access.workspace.id,
      rows.map((r) => r.detail),
    ),
  ]);
  const labels: Record<string, string> = m.admin.audit.actions;
  const lines = [
    ["date", "person", "category", "action", "event", "detail", "ip"].map(csv).join(","),
    ...rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.user?.name ?? "orgtable",
        auditCategory(r.action),
        r.action,
        Object.hasOwn(labels, r.action) ? labels[r.action] : r.action,
        r.detail ? (details.get(r.detail) ?? r.detail) : "",
        r.ip ?? "",
      ]
        .map(csv)
        .join(","),
    ),
  ];
  await recordAudit({
    action: "workspace.export",
    userId: access.userId,
    targetType: "workspace",
    targetId: access.workspace.id,
    detail: `audit.csv (${rows.length} rows)`,
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${access.workspace.slug}-activity-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
