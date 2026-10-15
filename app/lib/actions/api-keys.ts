"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import { prisma } from "@/app/lib/prisma";
import { apiTokenExpirySchema, apiTokenScopeSchema } from "@/app/lib/validators";
import { createApiKey, revokeApiKey } from "@/app/lib/services/api-keys";
import { getI18n } from "@/app/i18n/server";

// Organization API keys (docs/api/public-api.md, "Organization keys").

export type ApiKeyFormState = { error?: string; token?: string };

function text(formData: FormData, key: string, max = 100): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

async function refresh(workspaceId: string) {
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } });
  if (w) revalidatePath(`/${w.slug}/settings`, "layout");
}

export async function createApiKeyAction(_prev: ApiKeyFormState, formData: FormData): Promise<ApiKeyFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const name = text(formData, "name", 60).trim();
  const scope = apiTokenScopeSchema.safeParse(text(formData, "scope"));
  const expiry = apiTokenExpirySchema.safeParse(text(formData, "expiry"));
  if (!name || !scope.success || !expiry.success) return { error: m.errors.webhooks.nameRequired };
  const result = await createApiKey({ workspaceId, actorId: user.id, name, scope: scope.data, expiryDays: Number(expiry.data) });
  if (!result.ok) return { error: result.error === "too_many" ? m.errors.webhooks.tooMany : m.errors.workspaces.forbidden };
  await recordAudit({
    action: "workspace.apikey_created",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${result.id} ${name} (${scope.data})`,
  });
  await refresh(workspaceId);
  return { token: result.token };
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const keyId = text(formData, "keyId");
  const result = await revokeApiKey({ workspaceId, actorId: user.id, keyId });
  if (!result.ok) return;
  await recordAudit({ action: "workspace.apikey_revoked", userId: user.id, targetType: "workspace", targetId: workspaceId, detail: keyId });
  await refresh(workspaceId);
}
