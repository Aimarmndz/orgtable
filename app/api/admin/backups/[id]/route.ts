import { getCurrentUser } from "@/app/lib/dal";
import { backupBytes } from "@/app/lib/services/backups";

// GET /api/admin/backups/<id>: downloads an instance backup (plain .zip). Instance
// administrators only; anyone else gets 404. It holds every account's data: handle it so.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return new Response("Not found", { status: 404 });
  const { id } = await params;
  const found = await backupBytes(null, id).catch(() => null);
  if (!found) return new Response("Not found", { status: 404 });
  const stamp = found.createdAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="orgtable-instance-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
