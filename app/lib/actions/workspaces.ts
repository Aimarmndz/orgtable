"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import { getI18n, issueMessage } from "@/app/i18n/server";
import type { Messages } from "@/app/i18n/config";
import {
  createEmployeeSchema,
  employeePasswordSchema,
  memberRoleChoiceSchema,
  organizationSchema,
} from "@/app/lib/validators";
import {
  changeMemberRole,
  createEmployee,
  createOrganization,
  deleteOrganization,
  removeMember,
  resetEmployeePassword,
  updateWorkspace,
  updatePersonalHandle,
  type MemberError,
  type SlugError,
} from "@/app/lib/services/workspaces";
import { prisma } from "@/app/lib/prisma";
import { rateLimit } from "@/app/lib/rate-limit";
import { randomBytes } from "node:crypto";
import { isMailEnabled } from "@/app/lib/mail/config";
import { sendInvite } from "@/app/lib/services/account-tokens";
import { fmt } from "@/app/i18n/format";

// Server Actions of workspaces (organizations, their members and employees). Each one only
// resolves WHO is acting (the session) and turns the outcome into a message: every rule
// (who may grant what, the last owner…) is enforced by app/lib/services/workspaces.ts
// against the database. See docs/workspaces.md and docs/authorization.md.

// Per person and hour. Generous for a real team, a wall for a script creating accounts.
const ORG_LIMIT = 5;
const EMPLOYEE_LIMIT = 50;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const INVITES_PER_ORG_DAY = 100;
const INVITES_GLOBAL_DAY = 1000;

export type WorkspaceFormState = {
  error?: string;
  message?: string;
  values?: Record<string, string>;
};

function text(formData: FormData, key: string, max = 200): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

function slugErrorMessage(m: Messages, error: SlugError): string {
  if (error === "slug_reserved") return m.errors.workspaces.slugReserved;
  if (error === "slug_taken") return m.errors.workspaces.slugTaken;
  return m.errors.workspaces.slugFormat;
}

function memberErrorMessage(m: Messages, error: MemberError): string {
  switch (error) {
    case "closed":
      return m.errors.register.closed;
    case "email_taken":
      return m.errors.workspaces.emailTaken;
    case "last_owner":
      return m.errors.workspaces.lastOwner;
    case "self":
      return m.errors.workspaces.self;
    case "not_member":
      return m.errors.workspaces.notMember;
    case "role_not_found":
      return m.errors.workspaces.roleNotFound;
    case "domain_not_allowed":
      return m.errors.workspaces.domainNotAllowed;
    default:
      return m.errors.workspaces.forbidden;
  }
}

/** Slug of a workspace, to revalidate and redirect after a change. */
async function slugOf(workspaceId: string): Promise<string | null> {
  const w = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true },
  });
  return w?.slug ?? null;
}

/** Creates an organization owned by the current user and opens it. */
export async function createOrganizationAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const values = {
    name: text(formData, "name", 60),
    slug: text(formData, "slug", 39),
  };
  const parsed = organizationSchema.safeParse(values);
  if (!parsed.success)
    return { error: issueMessage(m, parsed.error.issues[0]), values };

    // Free, but not unlimited: a few organizations per person and hour (in memory, like the
  // sign-up limit; see app/lib/rate-limit.ts).
  if (!rateLimit(`orgs:${user.id}`, ORG_LIMIT, HOUR_MS).ok) {
    return { error: m.errors.workspaces.rateLimited, values };
  }
  const result = await createOrganization({ ownerId: user.id, ...parsed.data });
  if (!result.ok) {
    return {
      error:
        result.error === "closed" ? m.errors.register.closed : slugErrorMessage(m, result.error),
      values,
    };
  }
  await recordAudit({
    action: "workspace.created",
    userId: user.id,
    targetType: "workspace",
    targetId: result.workspace.id,
    detail: result.workspace.slug,
  });
  revalidatePath("/boards");
  redirect(`/${result.workspace.slug}`);
}

/** Renames an organization or changes its address (OWNER only). */
export async function updateWorkspaceAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const values = {
    name: text(formData, "name", 60),
    slug: text(formData, "slug", 39),
  };
  const parsed = organizationSchema.safeParse(values);
  if (!parsed.success)
    return { error: issueMessage(m, parsed.error.issues[0]), values };

  const result = await updateWorkspace({
    workspaceId,
    actorId: user.id,
    ...parsed.data,
  });
  if (!result.ok) {
    return {
      error:
        result.error === "forbidden"
          ? m.errors.workspaces.forbidden
          : slugErrorMessage(m, result.error),
      values,
    };
  }
  await recordAudit({
    action: "workspace.updated",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: result.slug,
  });
  revalidatePath("/boards");
  redirect(`/${result.slug}/settings/general`);
}

/** An owner or admin creates an employee's account in the organization. */
export async function createEmployeeAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const { m, locale } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const values = {
    name: text(formData, "name", 60),
    email: text(formData, "email", 254),
    role: text(formData, "role", 80),
  };
  // With email, the person chooses their own password from an invitation link: the account
  // starts with a random one that is never shown (the organization can still set a new one
  // later, as with any account it creates). Without email, the organization sets an initial
  // password and hands it over.
  const invite = isMailEnabled();
  const parsed = createEmployeeSchema.safeParse({
    ...values,
    password: invite ? randomBytes(24).toString("base64url") : formData.get("password"),
  });
  if (!parsed.success)
    return { error: issueMessage(m, parsed.error.issues[0]), values };

  // Invitations send email to addresses someone typed: besides the per-person limit, a cap
  // per organization and for the whole instance per day, so the service cannot be used to
  // flood inboxes.
  if (
    invite &&
    (!rateLimit(`invites:org:${workspaceId}`, INVITES_PER_ORG_DAY, DAY_MS).ok ||
      !rateLimit("invites:global", INVITES_GLOBAL_DAY, DAY_MS).ok)
  ) {
    return { error: m.errors.workspaces.rateLimited, values };
  }
  if (!rateLimit(`employees:${user.id}`, EMPLOYEE_LIMIT, HOUR_MS).ok) {
    return { error: m.errors.workspaces.rateLimited, values };
  }
  const result = await createEmployee({
    workspaceId,
    actorId: user.id,
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
    role: parsed.data.role.role,
    customRoleId: parsed.data.role.customRoleId,
    locale,
  });
  if (!result.ok) return { error: memberErrorMessage(m, result.error), values };
  await recordAudit({
    action: "workspace.member_created",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${result.userId} (${parsed.data.role.role}${parsed.data.role.customRoleId ? ` custom:${parsed.data.role.customRoleId}` : ""})`,
  });
    const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { slug: true, name: true },
  });
  if (workspace) revalidatePath(`/${workspace.slug}`, "layout");
  if (!invite) return { message: m.workspaces.members.created };
  const sent =
    workspace &&
    (await sendInvite({
      userId: result.userId,
      organization: workspace,
      inviterName: user.name,
      role: parsed.data.role.role,
    }));
  return sent
    ? { message: fmt(m.workspaces.members.invited, { email: parsed.data.email }) }
    : { error: m.workspaces.members.inviteFailed };
}

/**
 * Changes a member's role in the organization: a base role, or "custom:<id>" for one of its
 * custom roles (memberRoleChoiceSchema).
 */
export async function changeMemberRoleAction(
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const userId = text(formData, "userId");
  const parsed = memberRoleChoiceSchema.safeParse(formData.get("role"));
  if (!parsed.success) return;
  const result = await changeMemberRole({
    workspaceId,
    actorId: user.id,
    userId,
    role: parsed.data.role,
    customRoleId: parsed.data.customRoleId,
  });
  if (!result.ok || !result.changed) return;
  await recordAudit({
    action: "workspace.member_role_changed",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${userId} → ${parsed.data.role}${parsed.data.customRoleId ? ` custom:${parsed.data.customRoleId}` : ""}`,
  });
  const slug = await slugOf(workspaceId);
  if (slug) revalidatePath(`/${slug}`, "layout");
}

/** Removes someone from the organization, or leaves it (userId = yourself). */
export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const userId = text(formData, "userId");
  const result = await removeMember({ workspaceId, actorId: user.id, userId });
  if (!result.ok) return;
  const leaving = userId === user.id;
  await recordAudit({
    action: leaving ? "workspace.member_left" : "workspace.member_removed",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: leaving ? undefined : userId,
  });
  revalidatePath("/boards");
  if (leaving) redirect("/boards");
  const slug = await slugOf(workspaceId);
  if (slug) revalidatePath(`/${slug}`, "layout");
}

/** Sets a new password for an employee account the organization created. */
export async function resetEmployeePasswordAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const parsed = employeePasswordSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success)
    return { error: issueMessage(m, parsed.error.issues[0]) };
  const result = await resetEmployeePassword({
    workspaceId,
    actorId: user.id,
    userId: parsed.data.userId,
    password: parsed.data.password,
  });
  if (!result.ok) return { error: memberErrorMessage(m, result.error) };
  await recordAudit({
    action: "workspace.member_password_reset",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: parsed.data.userId,
  });
  return { message: m.workspaces.members.passwordReset };
}

/** Deletes the organization and its boards (OWNER only, after typing its address). */
export async function deleteOrganizationAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const slug = await slugOf(workspaceId);
  if (!slug || text(formData, "confirm", 39).trim().toLowerCase() !== slug) {
    return { error: m.workspaces.settings.deleteConfirmMismatch };
  }
  const result = await deleteOrganization({ workspaceId, actorId: user.id });
  if (!result.ok) return { error: memberErrorMessage(m, result.error) };
  await recordAudit({
    action: "workspace.deleted",
    userId: user.id,
    targetType: "workspace",
    targetId: workspaceId,
    detail: `${slug}, boards deleted: ${result.boardsDeleted}`,
  });
  revalidatePath("/boards");
  redirect("/boards");
}

/** Changes the person's handle (/<handle>, their personal boards' address). */
export async function updateHandleAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const values = { slug: text(formData, "slug", 39) };
  const result = await updatePersonalHandle(user.id, values.slug);
  if (!result.ok) return { error: slugErrorMessage(m, result.error), values };
  revalidatePath("/boards");
  revalidatePath("/settings", "layout");
  return { message: m.workspaces.handle.saved, values: { slug: result.slug } };
}
