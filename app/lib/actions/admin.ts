"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/dal";
import {
  createUserAccount,
  deleteUserAccount,
  resetPasswordAndRevokeAccess,
} from "@/app/lib/services/users";
import { revokeAllUserSessions } from "@/app/lib/session";
import { purgeWorkspace } from "@/app/lib/services/workspaces";
import { recordAudit } from "@/app/lib/audit";
import { clearTwoFactor } from "@/app/lib/services/two-factor";
import { getI18n, issueMessage } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";
import {
  createUserSchema,
  globalRoleSchema,
  resetPasswordSchema,
} from "@/app/lib/validators";

// User administration of the instance. Only the global ADMIN can create accounts, change
// the global role, reset passwords or delete users. Accounts are created here unless the
// instance has open registration (actions/register.ts). See docs/authorization.md and
// docs/admin.md.

export type CreateUserState = {
  error?: string;
  // Field the error refers to, to mark it (aria-invalid) in the form.
  field?: "email";
  message?: string;
  // What was typed, to refill the form after an error. NEVER the password: it must not
  // travel back to the browser.
  values?: { name: string; email: string; role: string };
};

function formText(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** Creates a user account. Returns state for useActionState. */
export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const admin = await requireAdmin();
  const { m } = await getI18n();
  const values = {
    name: formText(formData, "name"),
    email: formText(formData, "email"),
    role: formText(formData, "role"),
  };

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      error: issueMessage(m, parsed.error.issues[0]),
      values,
    };
  }

  // The creation logic (normalise the email, reject duplicates, hash) lives in the reusable,
  // testable service; here we only authorise and audit.
  const result = await createUserAccount(parsed.data);
  if (!result.ok) {
    return { error: m.errors.admin.emailTaken, field: "email", values };
  }
  await recordAudit({
    action: "user.created",
    userId: admin.id,
    targetType: "user",
    targetId: result.user.id,
    detail: `${result.user.email} (${parsed.data.role})`,
  });
  revalidatePath("/admin/users");
  return { message: fmt(m.errors.admin.userCreated, { name: parsed.data.name }) };
}

// Per-row actions (change role, reset password, delete) return their result through a
// redirect with a query (?ok=… / ?error=…) that the /admin/users page turns into a
// message. That avoids a client component per row.
function backToUsers(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(`/admin/users${qs ? `?${qs}` : ""}`);
}

// Target user id: `String(null)` would give "null" and the action would carry on.
function readUserId(formData: FormData): string {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId === "") backToUsers({ error: "invalid" });
  return userId;
}

/** Changes the global role (ADMIN/MEMBER). You cannot change your own role. */
export async function updateUserRole(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = readUserId(formData);
  const parsed = globalRoleSchema.safeParse(formData.get("role"));
  if (!parsed.success) backToUsers({ error: "invalid" });

  // You cannot demote yourself (avoids losing admin access).
  if (userId === admin.id) backToUsers({ error: "self-role" });

  // The count is checked before auditing: with an unknown id there is nothing to record.
  const { count } = await prisma.user.updateMany({
    where: { id: userId },
    data: { role: parsed.data },
  });
  if (count === 0) backToUsers({ error: "not-found" });
  await recordAudit({
    action: "user.role_changed",
    userId: admin.id,
    targetType: "user",
    targetId: userId,
    detail: `→ ${parsed.data}`,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "role" });
}

/** Resets a user's password (the admin types the new one). */
export async function resetUserPassword(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  // The userId is validated first: if it were missing, the schema error would be the
  // password one and the message ("at least 8 characters") would not describe the problem.
  const userId = readUserId(formData);
  const parsed = resetPasswordSchema.safeParse({
    userId,
    password: formData.get("password"),
  });
  if (!parsed.success) backToUsers({ error: "password" });

  // Changing the password withdraws all of the user's current access: their sessions
  // (browser) and their API tokens, which do not depend on the session. If the account was
  // compromised, a token created by the attacker would keep opening /api/v1.
  const result = await resetPasswordAndRevokeAccess(
    parsed.data.userId,
    parsed.data.password,
  );
  if (!result.ok) backToUsers({ error: "not-found" });
  await recordAudit({
    action: "user.password_reset",
    userId: admin.id,
    targetType: "user",
    targetId: parsed.data.userId,
    detail: `API tokens revoked: ${result.revokedTokens}`,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "password" });
}

/** Revokes all of a user's active sessions (immediate revocation). */
export async function revokeUserSessions(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = readUserId(formData);
  // Having 0 active sessions is valid, so existence is checked separately.
  const exists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!exists) backToUsers({ error: "not-found" });
  await revokeAllUserSessions(userId);
  await recordAudit({
    action: "user.sessions_revoked",
    userId: admin.id,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "revoked" });
}

/**
 * Turns off two-step verification of an account whose owner lost their phone and their
 * recovery codes. Their sessions are revoked too, so whoever is signed in with it has to
 * come back through the password (docs/authentication.md).
 */
export async function resetUserTwoFactor(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = readUserId(formData);
  if (userId === admin.id) backToUsers({ error: "invalid" });
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  if (!target) backToUsers({ error: "not-found" });
  if (target.totpEnabledAt) {
    await clearTwoFactor(userId);
    await revokeAllUserSessions(userId);
    await recordAudit({ action: "user.two_factor_reset", userId: admin.id, targetType: "user", targetId: userId });
  }
  revalidatePath("/admin/users");
  backToUsers({ ok: "twoFactorReset" });
}

/**
 * Deletes an account. You cannot delete yourself. If the user owns any board, it is
 * refused: deleting them would cascade to their boards. The admin must transfer or delete
 * those boards first.
 */
export async function deleteUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = readUserId(formData);

  if (userId === admin.id) backToUsers({ error: "self-delete" });

  // The owned-boards check is part of the DELETE itself (see the service): that way the
  // cascade never deletes Attachment rows leaving their files orphaned on disk.
  const result = await deleteUserAccount(userId);
  if (!result.ok) {
    backToUsers({
            error:
        result.error === "owns_boards"
          ? "owns-boards"
          : result.error === "sole_owner"
            ? "sole-owner"
            : "not-found",
    });
  }
  await recordAudit({
    action: "user.deleted",
    userId: admin.id,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "delete" });
}

// --- Workspaces (/admin/workspaces) ---------------------------------------------------------
// The instance administrator can suspend a workspace (nobody can open its boards; its
// members see the reason), lift the suspension or delete it. They never get access to the
// boards themselves: see docs/workspaces.md and the privacy policy.

const SUSPEND_REASON_MAX = 300;

export async function suspendWorkspace(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const workspaceId = formText(formData, "workspaceId");
  const reason = formText(formData, "reason").trim().slice(0, SUSPEND_REASON_MAX);
  const { count } = await prisma.workspace.updateMany({
    where: { id: workspaceId, suspendedAt: null },
    data: { suspendedAt: new Date(), suspendedReason: reason || null },
  });
  if (count > 0) {
    await recordAudit({
      action: "workspace.suspended",
      userId: admin.id,
      targetType: "workspace",
      targetId: workspaceId,
      detail: reason || undefined,
    });
  }
  revalidatePath("/admin/workspaces");
  redirect(`/admin/workspaces?ok=${count > 0 ? "suspended" : "unchanged"}`);
}

export async function unsuspendWorkspace(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const workspaceId = formText(formData, "workspaceId");
  const { count } = await prisma.workspace.updateMany({
    where: { id: workspaceId, suspendedAt: { not: null } },
    data: { suspendedAt: null, suspendedReason: null },
  });
  if (count > 0) {
    await recordAudit({
      action: "workspace.unsuspended",
      userId: admin.id,
      targetType: "workspace",
      targetId: workspaceId,
    });
  }
  revalidatePath("/admin/workspaces");
  redirect(`/admin/workspaces?ok=${count > 0 ? "unsuspended" : "unchanged"}`);
}

/** Deletes an ORGANIZATION and its boards, after typing its address. */
export async function deleteWorkspaceAsAdmin(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const workspaceId = formText(formData, "workspaceId");
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true, kind: true },
  });
  // Personal workspaces go with their account (delete the user instead).
  if (
    !workspace ||
    workspace.kind !== "ORGANIZATION" ||
    formText(formData, "confirm").trim().toLowerCase() !== workspace.slug
  ) {
    redirect("/admin/workspaces?error=confirm");
  }
  const boardsDeleted = await purgeWorkspace(workspaceId);
  await recordAudit({
    action: "workspace.deleted",
    userId: admin.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${workspace.slug}, boards deleted: ${boardsDeleted} (instance admin)`,
  });
  revalidatePath("/admin/workspaces");
  redirect("/admin/workspaces?ok=deleted");
}
