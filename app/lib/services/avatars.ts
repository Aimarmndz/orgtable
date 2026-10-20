import "server-only";
import { prisma } from "@/app/lib/prisma";
import { deleteAttachmentFile, MAX_LOGO_BYTES, saveAvatarFile, sniffLogoType } from "@/app/lib/storage";

// Profile photos (docs/privacy.md, "Profile photo"). The browser crops and shrinks the photo
// before sending it; here only the bytes count: PNG, JPEG or WebP read from the file itself
// (never SVG), up to the same limit as a logo.

export type AvatarError = "bad_image" | "too_big";

/** Replaces the person's photo; the old file goes. */
export async function setAvatar(
  userId: string,
  bytes: Buffer,
): Promise<{ ok: true } | { ok: false; error: AvatarError }> {
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: "too_big" };
  const type = sniffLogoType(bytes);
  if (!type) return { ok: false, error: "bad_image" };
  const storedName = await saveAvatarFile(bytes, type.ext);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarStoredName: true } });
  await prisma.user.update({ where: { id: userId }, data: { avatarStoredName: storedName, avatarMimeType: type.mime } });
  if (before.avatarStoredName) await deleteAttachmentFile(before.avatarStoredName);
  return { ok: true };
}

export async function removeAvatar(userId: string): Promise<void> {
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarStoredName: true } });
  await prisma.user.update({ where: { id: userId }, data: { avatarStoredName: null, avatarMimeType: null } });
  if (before.avatarStoredName) await deleteAttachmentFile(before.avatarStoredName);
}

/**
 * Whether `viewerId` may see the photo of `ownerId`: themselves, or someone they already
 * see in the app. That is, they share an organization or a board, or one of them is on a
 * board of the other's organization (a guest and the organization's people). Anyone else
 * gets a 404, so photos cannot be collected by trying ids.
 */
export async function canSeeAvatar(viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return true;
  const shared = await prisma.user.count({
    where: {
      id: ownerId,
      OR: [
        { workspaceMemberships: { some: { workspace: { members: { some: { userId: viewerId } } } } } },
        { memberships: { some: { board: { members: { some: { userId: viewerId } } } } } },
        { memberships: { some: { board: { workspace: { members: { some: { userId: viewerId } } } } } } },
        { workspaceMemberships: { some: { workspace: { boards: { some: { members: { some: { userId: viewerId } } } } } } } },
      ],
    },
  });
  return shared > 0;
}
