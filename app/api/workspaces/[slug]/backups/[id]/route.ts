import { orgAccessFromSession } from "@/app/lib/org-settings";
import { backupBytes } from "@/app/lib/services/backups";

// GET /api/workspaces/<slug>/backups/<id>: downloads one of the organization's backups, as a
// plain .zip (decrypted if it was stored encrypted). "backups.manage"; anyone else gets 404.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const access = await orgAccessFromSession(slug, "backups.manage");
  if (!access) return new Response("Not found", { status: 404 });
  const found = await backupBytes(access.workspace.id, id).catch(() => null);
  if (!found) return new Response("Not found", { status: 404 });
  const stamp = found.createdAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${access.workspace.slug}-backup-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
