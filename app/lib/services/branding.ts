import "server-only";
import { prisma } from "@/app/lib/prisma";
import { workspaceAccessOf } from "@/app/lib/access";
import { canManageWorkspace } from "@/app/lib/roles";
import { BOARD_COLOR_KEYS } from "@/app/lib/colors";
import { deleteAttachmentFile, MAX_LOGO_BYTES, saveLogoFile, sniffLogoType } from "@/app/lib/storage";

// Brand of an organization (docs/workspaces.md, "Brand"): colour, logo and time zone. Owners
// and admins change it; renaming and the address stay with owners (services/workspaces.ts).

export type BrandError = "forbidden" | "bad_color" | "bad_timezone" | "bad_image" | "too_big";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function mayBrand(workspaceId: string, actorId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return false;
  const actor = await workspaceAccessOf(workspaceId, actorId);
  return Boolean(actor && canManageWorkspace(actor.role));
}

export async function updateBrand(input: {
  workspaceId: string;
  actorId: string;
  brandColor: string | null;
  timezone: string | null;
}): Promise<{ ok: true } | { ok: false; error: BrandError }> {
  if (!(await mayBrand(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if (input.brandColor && !(BOARD_COLOR_KEYS as string[]).includes(input.brandColor)) {
    return { ok: false, error: "bad_color" };
  }
  if (input.timezone && !isValidTimeZone(input.timezone)) return { ok: false, error: "bad_timezone" };
  await prisma.workspace.update({
    where: { id: input.workspaceId },
    data: { brandColor: input.brandColor, timezone: input.timezone },
  });
  return { ok: true };
}

/** Replaces the logo. The type is read from the bytes (PNG, JPEG, WebP), never trusted. */
export async function setLogo(input: {
  workspaceId: string;
  actorId: string;
  bytes: Buffer;
}): Promise<{ ok: true } | { ok: false; error: BrandError }> {
  if (!(await mayBrand(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if (input.bytes.length > MAX_LOGO_BYTES) return { ok: false, error: "too_big" };
  const type = sniffLogoType(input.bytes);
  if (!type) return { ok: false, error: "bad_image" };
  const storedName = await saveLogoFile(input.bytes, type.ext);
  const before = await prisma.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { logoStoredName: true },
  });
  await prisma.workspace.update({
    where: { id: input.workspaceId },
    data: { logoStoredName: storedName, logoMimeType: type.mime },
  });
  if (before.logoStoredName) await deleteAttachmentFile(before.logoStoredName);
  return { ok: true };
}

export async function removeLogo(input: {
  workspaceId: string;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; error: BrandError }> {
  if (!(await mayBrand(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const before = await prisma.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { logoStoredName: true },
  });
  await prisma.workspace.update({
    where: { id: input.workspaceId },
    data: { logoStoredName: null, logoMimeType: null },
  });
  if (before.logoStoredName) await deleteAttachmentFile(before.logoStoredName);
  return { ok: true };
}
