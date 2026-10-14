import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/app/lib/prisma";
import { parseTrustedProxyHops, pickClientIp } from "@/app/lib/client-ip";

// Audit log. `recordAudit` writes one row per relevant security or operations event. It
// must NEVER break the main operation: a failed write is not rethrown, but it is recorded
// in the server log (without detail, ip or personal data). See the AuditLog model in
// prisma/schema.prisma and the view at /admin/audit (docs/operations.md).

export type AuditAction =
  | "setup.completed"
  | "auth.login"
  | "auth.login_failed"
  | "auth.login_rate_limited"
  | "auth.logout"
  | "auth.registered"
  | "auth.register_rate_limited"
  | "account.updated"
  | "account.password_changed"
  | "account.sessions_revoked"
  | "account.exported"
  | "account.deleted"
  | "instance.updated"
  | "user.created"
  | "user.deleted"
  | "user.role_changed"
  | "user.password_reset"
  | "user.sessions_revoked"
  | "board.created"
  | "board.deleted"
  | "board.visibility_changed"
  | "workspace.created"
  | "workspace.updated"
  | "workspace.deleted"
  | "workspace.suspended"
  | "workspace.unsuspended"
  | "workspace.member_created"
  | "workspace.member_role_changed"
  | "workspace.member_removed"
  | "workspace.member_left"
  | "workspace.member_password_reset"
  | "member.added"
  | "member.removed"
  | "member.role_changed"
  | "apitoken.created"
  | "apitoken.revoked";

/**
 * Client IP from X-Forwarded-For and TRUSTED_PROXY_HOPS (see app/lib/client-ip.ts). null
 * when no trusted proxies are declared: a Server Action cannot read the socket's IP, and
 * without a proxy in front the client writes the header itself. X-Real-IP is not used for
 * the same reason.
 */
export async function clientIp(): Promise<string | null> {
  const hops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
  const h = await headers();
  return pickClientIp(h.get("x-forwarded-for"), hops);
}

export async function recordAudit(params: {
  action: AuditAction;
  userId?: string | null;
  targetType?: string;
  targetId?: string;
  detail?: string;
  ip?: string | null;
}): Promise<void> {
  try {
    const ip = params.ip !== undefined ? params.ip : await clientIp();
    await prisma.auditLog.create({
      data: {
        action: params.action,
        userId: params.userId ?? null,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        detail: params.detail?.slice(0, 500) ?? null,
        ip: ip ?? null,
      },
    });
  } catch (error) {
    // Best-effort: not rethrown so the audited action does not fail, but silently losing
    // a security event is not acceptable.
    console.error("[audit] could not write to AuditLog", {
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      error: describeError(error),
    });
  }
}

/**
 * Error summary for the log. PrismaClientValidationError's message echoes the query
 * arguments (detail, ip…), so in that case only the type is logged.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 200);
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  if (error.name === "PrismaClientValidationError") return `${error.name}${code}`;
  return `${error.name}${code}: ${error.message.slice(0, 500)}`;
}
