"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, verifySession } from "@/app/lib/dal";
import {
  changeOwnPassword,
  deleteOwnAccount,
  revokeOtherSessions as revokeOtherSessionsService,
  revokeOwnSession,
  updateOwnProfile,
} from "@/app/lib/services/account";
import { recordAudit } from "@/app/lib/audit";
import { getI18n, issueMessage } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";
import {
  changePasswordSchema,
  deleteAccountSchema,
  profileSchema,
} from "@/app/lib/validators";

// /settings actions on one's own account. The logic lives in services/account.ts; here the
// user is resolved, input validated, the event audited and the page revalidated. See
// docs/privacy.md.

export type AccountFormState = {
  error?: string;
  // Field the error refers to, to mark it with aria-invalid.
  field?: string;
  message?: string;
  values?: Record<string, string>;
};

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** The current session is required: the actions need its id so as not to revoke it. */
async function requireSessionId(): Promise<string> {
  const session = await verifySession();
  if (!session) redirect("/login");
  return session.sessionId;
}

export async function updateProfile(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const values = { name: text(formData, "name"), email: text(formData, "email") };
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    currentPassword: text(formData, "currentPassword"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issueMessage(m, issue),
      field: String(issue?.path[0] ?? ""),
      values,
    };
  }

  const result = await updateOwnProfile(user.id, parsed.data);
  if (!result.ok) {
    if (result.error === "wrong_password") {
      return {
        error: m.errors.account.emailChangeNeedsPassword,
        field: "currentPassword",
        values,
      };
    }
    if (result.error === "email_taken") {
      return { error: m.errors.account.emailTaken, field: "email", values };
    }
    redirect("/login");
  }

  await recordAudit({
    action: "account.updated",
    userId: user.id,
    detail: result.emailChanged ? "name and email" : "name",
  });
  revalidatePath("/", "layout");
  return { message: m.errors.account.profileSaved };
}

export async function changePassword(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  const sessionId = await requireSessionId();
  const { m, intl } = await getI18n();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: text(formData, "currentPassword"),
    newPassword: text(formData, "newPassword"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issueMessage(m, issue), field: String(issue?.path[0] ?? "") };
  }

  const result = await changeOwnPassword(user.id, {
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
    keepSessionId: sessionId,
  });
  if (!result.ok) {
    if (result.error === "wrong_password") {
      return { error: m.errors.account.wrongCurrentPassword, field: "currentPassword" };
    }
    redirect("/login");
  }

  await recordAudit({
    action: "account.password_changed",
    userId: user.id,
    detail: `other sessions revoked: ${result.revokedSessions}`,
  });
  revalidatePath("/settings", "layout");
  return {
    message:
      result.revokedSessions > 0
        ? plural(intl, m.errors.account.passwordChangedSessionsClosed, result.revokedSessions)
        : m.errors.account.passwordChanged,
  };
}

/** Revokes one of one's own sessions from the list of open sessions. */
export async function revokeSession(formData: FormData): Promise<void> {
  const user = await requireUser();
  const currentId = await requireSessionId();
  const sessionId = text(formData, "sessionId");
  // The current one is closed with "Sign out", which also deletes the cookie.
  if (sessionId && sessionId !== currentId) {
    const count = await revokeOwnSession(user.id, sessionId);
    if (count > 0) {
      await recordAudit({ action: "account.sessions_revoked", userId: user.id, detail: "1" });
    }
  }
  revalidatePath("/settings", "layout");
  redirect("/settings/security");
}

export async function revokeOtherSessions(): Promise<void> {
  const user = await requireUser();
  const currentId = await requireSessionId();
  const count = await revokeOtherSessionsService(user.id, currentId);
  if (count > 0) {
    await recordAudit({
      action: "account.sessions_revoked",
      userId: user.id,
      detail: String(count),
    });
  }
  revalidatePath("/settings", "layout");
  redirect("/settings/security");
}

export async function deleteAccount(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const parsed = deleteAccountSchema.safeParse({ password: text(formData, "password") });
  if (!parsed.success) {
    return { error: issueMessage(m, parsed.error.issues[0]), field: "password" };
  }

  const result = await deleteOwnAccount(user.id, parsed.data.password);
  if (!result.ok) {
    if (result.error === "wrong_password") {
      return { error: m.errors.account.wrongPassword, field: "password" };
    }
    if (result.error === "last_admin") {
      return { error: m.errors.account.lastAdmin };
    }
    if (result.error === "sole_owner") {
      return {
        error: fmt(m.errors.account.soleOwner, { organizations: result.organizations.join(", ") }),
      };
    }
    redirect("/login");
  }

  // The audit row has no userId: the account no longer exists and must not stay linked.
  await recordAudit({
    action: "account.deleted",
    detail: `boards deleted: ${result.boardsDeleted}`,
  });
  // Sessions were deleted in cascade; the cookie is no longer valid, but it is removed anyway.
  (await cookies()).delete("session");
  redirect("/login?account=deleted");
}
