import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/app/lib/prisma";
import { parseTrustedProxyHops, pickClientIp } from "@/app/lib/client-ip";

// Registro de auditoría (Hito 5). `recordAudit` escribe una fila por evento relevante
// de seguridad u operación. Está pensado para NO romper nunca la operación principal:
// cualquier fallo se traga en silencio. Ver el modelo AuditLog en prisma/schema.prisma
// y la vista en /admin/audit (docs/operations.md).

export type AuditAction =
  | "setup.completed"
  | "auth.login"
  | "auth.login_failed"
  | "auth.login_rate_limited"
  | "auth.logout"
  | "user.created"
  | "user.deleted"
  | "user.role_changed"
  | "user.password_reset"
  | "user.sessions_revoked"
  | "board.created"
  | "board.deleted"
  | "member.added"
  | "member.removed"
  | "member.role_changed"
  | "apitoken.created"
  | "apitoken.revoked";

/**
 * IP del cliente según X-Forwarded-For y TRUSTED_PROXY_HOPS (ver app/lib/client-ip.ts).
 * null si no hay proxies de confianza declarados: desde una Server Action no se puede
 * leer la IP del socket, y la cabecera sin proxy delante la escribe el propio cliente.
 * X-Real-IP no se usa por lo mismo.
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
  } catch {
    // La auditoría es best-effort: nunca debe hacer fallar la acción que la origina.
  }
}
