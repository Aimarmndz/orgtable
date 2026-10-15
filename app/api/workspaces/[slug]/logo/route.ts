import { verifySession } from "@/app/lib/dal";
import { getWorkspaceForUser } from "@/app/lib/queries";
import { prisma } from "@/app/lib/prisma";
import { readAttachmentFile } from "@/app/lib/storage";

// GET /api/workspaces/<slug>/logo: an organization's logo, for whoever can see the
// organization (a member, or a guest of one of its boards). Everyone else gets 404. The type
// was sniffed from the bytes on upload (PNG, JPEG, WebP; never SVG) and is sent with nosniff.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await verifySession();
  if (!session) return new Response("Not found", { status: 404 });
  const visible = await getWorkspaceForUser(slug, session.userId);
  if (!visible) return new Response("Not found", { status: 404 });
  const w = await prisma.workspace.findUnique({
    where: { id: visible.id },
    select: { logoStoredName: true, logoMimeType: true },
  });
  if (!w?.logoStoredName || !w.logoMimeType) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readAttachmentFile(w.logoStoredName);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": w.logoMimeType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
