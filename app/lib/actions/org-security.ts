"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import { prisma } from "@/app/lib/prisma";
import {
  resetManagedTwoFactor,
  revokeManagedSessions,
  updateOrgSecurity,
  type SecurityError,
} from "@/app/lib/services/org-security";
import { getI18n } from "@/app/i18n/server";
import type { Messages } from "@/app/i18n/config";

// Server Actions of an organization's security page (docs/workspaces.md, "Security"). The
// rules live in app/lib/services/org-security.ts.

export type SecurityFormState = { error?: string; message?: string };

function text(formData: FormData, key: string, max = 200): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function errorMessage(m: Messages, error: SecurityError): string {
  switch (error) {
    case "actor_needs_2fa":
      return m.errors.workspaces.actorNeeds2fa;
    case "bad_domain":
      return m.errors.workspaces.badDomain;
    case "too_many_domains":
      return m.errors.workspaces.tooManyDomains;
    default:
      return m.errors.workspaces.forbidden;
  }
}

async function refresh(workspaceId: string) {
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } });
  if (w) revalidatePath(`/${w.slug}`, "layout");
  revalidatePath("/boards");
}

export async function updateOrgSecurityAction(
  _prev: SecurityFormState,
  formData: FormData,
): Promise<SecurityFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const result = await updateOrgSecurity({
    workspaceId,
    actorId: user.id,
    requireTwoFactor: formData.get("requireTwoFactor") === "on",
    domains: text(formData, "domains", 2000).split(/[\s,;]+/),
  });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  if (result.changed.length > 0) {
    await recordAudit({
      action: "workspace.security_updated",
      userId: user.id,
      targetType: "workspace",
      targetId: workspaceId,
      detail: result.changed.join("; "),
    });
  }
  await refresh(workspaceId);
  return { message: m.workspaces.security.saved };
}

export async function revokeManagedSessionsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const userId = text(formData, "userId");
  const sessionId = text(formData, "sessionId") || undefined;
  const result = await revokeManagedSessions({ workspaceId, actorId: user.id, userId, sessionId });
  if (!result.ok || result.count === 0) return;
  await recordAudit({
    action: "workspace.security_sessions_revoked",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${userId} (${result.count})`,
  });
  await refresh(workspaceId);
}

export async function resetManagedTwoFactorAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const userId = text(formData, "userId");
  const result = await resetManagedTwoFactor({ workspaceId, actorId: user.id, userId });
  if (!result.ok) return;
  await recordAudit({
    action: "workspace.security_two_factor_reset",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: userId,
  });
  await refresh(workspaceId);
}
