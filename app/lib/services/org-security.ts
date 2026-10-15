import "server-only";
import { prisma } from "@/app/lib/prisma";
import { workspaceAccessOf } from "@/app/lib/access";
import { canActOnWorkspaceMember, canManageWorkspace } from "@/app/lib/roles";
import { clearTwoFactor } from "@/app/lib/services/two-factor";
import { emailDomainAllowed, normalizeDomain } from "@/app/lib/email-domains";

// Security policy of an organization (docs/workspaces.md, "Security"): mandatory two-step
// verification, the email domains it may invite, and the sessions of the accounts it created.
// Only owners and admins change it (it is not a permission a custom role can hold).

export const MAX_DOMAINS = 20;

export async function workspaceEmailAllowed(workspaceId: string, email: string): Promise<boolean> {
  const w = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { allowedEmailDomains: true } });
  return emailDomainAllowed(w?.allowedEmailDomains ?? [], email);
}

export type SecurityError = "forbidden" | "actor_needs_2fa" | "bad_domain" | "too_many_domains" | "not_member";

async function managerOf(workspaceId: string, actorId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return null;
  const actor = await workspaceAccessOf(workspaceId, actorId);
  return actor && canManageWorkspace(actor.role) ? actor : null;
}

/**
 * Changes the policy. Turning on mandatory two-step verification requires the person doing
 * it to have it themselves: otherwise they would lock themselves out of every board.
 */
export async function updateOrgSecurity(input: {
  workspaceId: string;
  actorId: string;
  requireTwoFactor: boolean;
  domains: string[];
}): Promise<{ ok: true; changed: string[] } | { ok: false; error: SecurityError }> {
  if (!(await managerOf(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const domains: string[] = [];
  for (const raw of input.domains) {
    if (!raw.trim()) continue;
    const d = normalizeDomain(raw);
    if (!d) return { ok: false, error: "bad_domain" };
    if (!domains.includes(d)) domains.push(d);
  }
  if (domains.length > MAX_DOMAINS) return { ok: false, error: "too_many_domains" };
  const current = await prisma.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { requireTwoFactor: true, allowedEmailDomains: true },
  });
  if (input.requireTwoFactor && !current.requireTwoFactor) {
    const actor = await prisma.user.findUnique({ where: { id: input.actorId }, select: { totpEnabledAt: true } });
    if (!actor?.totpEnabledAt) return { ok: false, error: "actor_needs_2fa" };
  }
  const changed: string[] = [];
  if (input.requireTwoFactor !== current.requireTwoFactor) changed.push(`requireTwoFactor=${input.requireTwoFactor}`);
  if (domains.join(",") !== current.allowedEmailDomains.join(",")) changed.push(`domains=${domains.join(",") || "any"}`);
  await prisma.workspace.update({
    where: { id: input.workspaceId },
    data: { requireTwoFactor: input.requireTwoFactor, allowedEmailDomains: domains },
  });
  return { ok: true, changed };
}

/** Members with their two-step status, and the open sessions of the accounts it created. */
export async function orgSecurityOverview(workspaceId: string, now: Date) {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: { user: { name: "asc" } },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          managedById: true,
          totpEnabledAt: true,
          sessions: {
            where: { revokedAt: null, expiresAt: { gt: now } },
            orderBy: { createdAt: "desc" },
            select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
          },
        },
      },
    },
  });
  return members.map((m) => ({
    role: m.role,
    id: m.user.id,
    name: m.user.name,
    email: m.user.email,
    twoFactor: Boolean(m.user.totpEnabledAt),
    managedHere: m.user.managedById === workspaceId,
    // Only accounts this organization created: the others' devices are their own business.
    sessions: m.user.managedById === workspaceId ? m.user.sessions : [],
  }));
}

/**
 * Who an owner or admin may act on for account security (sessions, two-step reset): a
 * member whose account THIS organization created, whose role they may act on, never
 * themselves. The same rule as resetting a password.
 */
async function managedTarget(workspaceId: string, actorId: string, userId: string) {
  if (actorId === userId) return false;
  const actor = await managerOf(workspaceId, actorId);
  if (!actor) return false;
  const target = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true, user: { select: { managedById: true } } },
  });
  return Boolean(target && target.user.managedById === workspaceId && canActOnWorkspaceMember(actor.role, target.role));
}

/** Closes one session (or all, without sessionId) of a managed account. */
export async function revokeManagedSessions(input: {
  workspaceId: string;
  actorId: string;
  userId: string;
  sessionId?: string;
}): Promise<{ ok: true; count: number } | { ok: false; error: SecurityError }> {
  if (!(await managedTarget(input.workspaceId, input.actorId, input.userId))) return { ok: false, error: "forbidden" };
  const { count } = await prisma.session.updateMany({
    where: { userId: input.userId, revokedAt: null, ...(input.sessionId ? { id: input.sessionId } : {}) },
    data: { revokedAt: new Date() },
  });
  return { ok: true, count };
}

/** Turns off two-step verification of a managed account that lost its phone and codes. */
export async function resetManagedTwoFactor(input: {
  workspaceId: string;
  actorId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: SecurityError }> {
  if (!(await managedTarget(input.workspaceId, input.actorId, input.userId))) return { ok: false, error: "forbidden" };
  await clearTwoFactor(input.userId);
  await prisma.session.updateMany({ where: { userId: input.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return { ok: true };
}
