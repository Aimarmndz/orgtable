"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import { prisma } from "@/app/lib/prisma";
import { removeLogo, setLogo, updateBrand, type BrandError } from "@/app/lib/services/branding";
import { MAX_LOGO_BYTES } from "@/app/lib/storage";
import { getI18n } from "@/app/i18n/server";
import type { Messages } from "@/app/i18n/config";

// Brand of an organization: colour, time zone and logo (docs/workspaces.md, "Brand").

export type BrandFormState = { error?: string; message?: string };

function text(formData: FormData, key: string, max = 100): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function errorMessage(m: Messages, error: BrandError): string {
  switch (error) {
    case "bad_image":
      return m.errors.workspaces.badLogo;
    case "too_big":
      return m.errors.workspaces.logoTooBig;
    case "bad_timezone":
      return m.errors.workspaces.badTimezone;
    default:
      return m.errors.workspaces.forbidden;
  }
}

async function done(workspaceId: string, userId: string, detail: string) {
  await recordAudit({ action: "workspace.brand_updated", userId, targetType: "workspace", targetId: workspaceId, detail });
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } });
  if (w) revalidatePath(`/${w.slug}`, "layout");
  revalidatePath("/settings/workspaces");
}

export async function updateBrandAction(_prev: BrandFormState, formData: FormData): Promise<BrandFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const brandColor = text(formData, "brandColor", 20) || null;
  const timezone = text(formData, "timezone", 64) || null;
  const result = await updateBrand({ workspaceId, actorId: user.id, brandColor, timezone });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await done(workspaceId, user.id, `color=${brandColor ?? "auto"} tz=${timezone ?? "instance"}`);
  return { message: m.workspaces.brand.saved };
}

export async function uploadLogoAction(_prev: BrandFormState, formData: FormData): Promise<BrandFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: m.errors.workspaces.badLogo };
  // Checked before reading it into memory.
  if (file.size > MAX_LOGO_BYTES) return { error: m.errors.workspaces.logoTooBig };
  const result = await setLogo({ workspaceId, actorId: user.id, bytes: Buffer.from(await file.arrayBuffer()) });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await done(workspaceId, user.id, "logo");
  return { message: m.workspaces.brand.logoSaved };
}

export async function removeLogoAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const result = await removeLogo({ workspaceId, actorId: user.id });
  if (result.ok) await done(workspaceId, user.id, "logo removed");
}
