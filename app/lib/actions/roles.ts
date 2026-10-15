"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import { prisma } from "@/app/lib/prisma";
import { customRoleSchema } from "@/app/lib/validators";
import {
  createCustomRole,
  deleteCustomRole,
  duplicateCustomRole,
  updateCustomRole,
  type RoleError,
} from "@/app/lib/services/roles";
import { getI18n, issueMessage } from "@/app/i18n/server";
import type { Messages } from "@/app/i18n/config";

// Server Actions of an organization's custom roles (docs/roles.md). They resolve who is
// acting and audit; app/lib/services/roles.ts enforces every rule against the database.

export type RoleFormState = { error?: string; message?: string };

function text(formData: FormData, key: string, max = 200): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function roleErrorMessage(m: Messages, error: RoleError): string {
  switch (error) {
    case "name_taken":
      return m.errors.workspaces.roleNameTaken;
    case "too_many":
      return m.errors.workspaces.tooManyRoles;
    case "not_found":
      return m.errors.workspaces.roleNotFound;
    default:
      return m.errors.workspaces.forbidden;
  }
}

function parseRole(formData: FormData) {
  return customRoleSchema.safeParse({
    name: text(formData, "name", 120),
    color: text(formData, "color", 20),
    description: text(formData, "description", 400),
    permissions: formData.getAll("permissions").filter((v) => typeof v === "string"),
  });
}

async function rolesPath(workspaceId: string): Promise<string | null> {
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } });
  return w ? `/${w.slug}/settings/roles` : null;
}

export async function createRoleAction(
  _prev: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const parsed = parseRole(formData);
  if (!parsed.success) return { error: issueMessage(m, parsed.error.issues[0]) };
  const result = await createCustomRole({ workspaceId, actorId: user.id, role: parsed.data });
  if (!result.ok) return { error: roleErrorMessage(m, result.error) };
  await recordAudit({
    action: "workspace.role_created",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${result.id} ${parsed.data.name}`,
  });
  const path = await rolesPath(workspaceId);
  if (!path) return {};
  revalidatePath(path, "layout");
  redirect(`${path}/${result.id}`);
}

export async function updateRoleAction(
  _prev: RoleFormState,
  formData: FormData,
): Promise<RoleFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const roleId = text(formData, "roleId");
  const parsed = parseRole(formData);
  if (!parsed.success) return { error: issueMessage(m, parsed.error.issues[0]) };
  const result = await updateCustomRole({ workspaceId, actorId: user.id, roleId, role: parsed.data });
  if (!result.ok) return { error: roleErrorMessage(m, result.error) };
  await recordAudit({
    action: "workspace.role_updated",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${roleId} ${parsed.data.name}: ${parsed.data.permissions.join(" ")}`,
  });
  const path = await rolesPath(workspaceId);
  if (path) revalidatePath(path, "layout");
  return { message: m.workspaces.rolesPage.saved };
}

export async function duplicateRoleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const roleId = text(formData, "roleId");
  const result = await duplicateCustomRole({ workspaceId, actorId: user.id, roleId });
  if (!result.ok) return;
  await recordAudit({
    action: "workspace.role_created",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${result.id} (copy of ${roleId})`,
  });
  const path = await rolesPath(workspaceId);
  if (!path) return;
  revalidatePath(path, "layout");
  redirect(`${path}/${result.id}`);
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const roleId = text(formData, "roleId");
  const result = await deleteCustomRole({ workspaceId, actorId: user.id, roleId });
  if (!result.ok) return;
  await recordAudit({
    action: "workspace.role_deleted",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${roleId} (${result.members} members back to Member)`,
  });
  const path = await rolesPath(workspaceId);
  if (!path) return;
  revalidatePath(`/${path.split("/")[1]}`, "layout");
  redirect(path);
}
