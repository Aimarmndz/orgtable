import { orgAccessFromSession } from "@/app/lib/org-settings";
import { importIntoOrganization } from "@/app/lib/services/backups";
import { recordAudit } from "@/app/lib/audit";

// POST /api/workspaces/<slug>/import (multipart, field "file"): imports an orgtable .zip into
// the organization, after a safety backup (docs/backups.md). "backups.manage". A route and
// not a Server Action because exports with attachments are larger than an action's body
// limit. Up to ORGTABLE_IMPORT_MAX_MB (200 by default).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function maxBytes(): number {
  const n = Number(process.env.ORGTABLE_IMPORT_MAX_MB || 200);
  return (Number.isFinite(n) && n > 0 ? n : 200) * 1024 * 1024;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await orgAccessFromSession(slug, "backups.manage");
  if (!access) return Response.json({ error: "not_found" }, { status: 404 });
  // Same origin only: a cross-site form must not be able to import into someone's organization.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes()) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "invalid_archive" }, { status: 400 });
  if (file.size > maxBytes()) return Response.json({ error: "too_large" }, { status: 413 });
  const result = await importIntoOrganization({
    workspaceId: access.workspace.id,
    actorId: access.userId,
    zip: Buffer.from(await file.arrayBuffer()),
  });
  if (!result.ok) return Response.json({ error: result.error, detail: result.detail }, { status: 422 });
  await recordAudit({
    action: "workspace.import",
    userId: access.userId,
    targetType: "workspace",
    targetId: access.workspace.id,
    detail: `${file.name}: ${result.summary.boards} boards, ${result.summary.cards} cards`,
  });
  return Response.json({ summary: result.summary }, { status: 201 });
}
