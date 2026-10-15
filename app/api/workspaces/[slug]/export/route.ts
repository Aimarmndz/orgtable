import { orgAccessFromSession } from "@/app/lib/org-settings";
import { buildOrganizationZip } from "@/app/lib/backups/organization";
import { recordAudit } from "@/app/lib/audit";

// GET /api/workspaces/<slug>/export[?attachments=0]: the organization's data as a .zip to
// download or to import elsewhere (docs/backups.md, "Format"). Browser session and
// "data.export"; anyone else gets 404. Nothing is stored on the server.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await orgAccessFromSession(slug, "data.export");
  if (!access) return new Response("Not found", { status: 404 });
  const withFiles = new URL(request.url).searchParams.get("attachments") !== "0";
  const zip = await buildOrganizationZip(access.workspace.id, withFiles);
  await recordAudit({
    action: "workspace.export",
    userId: access.userId,
    targetType: "workspace",
    targetId: access.workspace.id,
    detail: `organization.zip${withFiles ? "" : " (no attachments)"}`,
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${access.workspace.slug}-${date}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
