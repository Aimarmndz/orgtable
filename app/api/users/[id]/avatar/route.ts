import { verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { canSeeAvatar } from "@/app/lib/services/avatars";
import { readAttachmentFile } from "@/app/lib/storage";

// GET /api/users/<id>/avatar: a person's profile photo, for themselves and whoever shares an
// organization or a board with them (canSeeAvatar). Everyone else, and a person without a
// photo, gets 404. The type was sniffed from the bytes on upload and is sent with nosniff.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await verifySession();
  if (!session || !(await canSeeAvatar(session.userId, id))) return new Response("Not found", { status: 404 });
  const user = await prisma.user.findUnique({ where: { id }, select: { avatarStoredName: true, avatarMimeType: true } });
  if (!user?.avatarStoredName || !user.avatarMimeType) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readAttachmentFile(user.avatarStoredName);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": user.avatarMimeType,
        "X-Content-Type-Options": "nosniff",
        // The URL carries the stored name (?v=), so a new photo is a new URL.
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
