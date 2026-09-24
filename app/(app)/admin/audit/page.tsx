import Link from "next/link";
import { requireAdmin } from "@/app/lib/dal";
import { getRecentAuditLogs } from "@/app/lib/queries";
import type { AuditAction } from "@/app/lib/audit";
import { formatDateTime } from "@/app/lib/format-date";

// Etiquetas legibles para cada acción auditada.
const ACTION_LABELS: Record<AuditAction, string> = {
  "setup.completed": "Configuración inicial completada",
  "auth.login": "Inicio de sesión",
  "auth.login_failed": "Inicio de sesión fallido",
  "auth.login_rate_limited": "Login bloqueado por límite de intentos",
  "auth.logout": "Cierre de sesión",
  "user.created": "Usuario creado",
  "user.deleted": "Usuario borrado",
  "user.role_changed": "Rol de usuario cambiado",
  "user.password_reset": "Contraseña restablecida",
  "user.sessions_revoked": "Sesiones cerradas",
  "board.created": "Tablero creado",
  "board.deleted": "Tablero borrado",
  "member.added": "Miembro añadido",
  "member.removed": "Miembro quitado",
  "member.role_changed": "Rol de miembro cambiado",
  "apitoken.created": "Token de API creado",
  "apitoken.revoked": "Token de API revocado",
};

// Acciones de riesgo que conviene resaltar.
const WARN_ACTIONS = new Set<string>([
  "auth.login_failed",
  "auth.login_rate_limited",
  "user.deleted",
  "board.deleted",
]);

function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

export default async function AdminAuditPage() {
  await requireAdmin();
  const logs = await getRecentAuditLogs();

  return (
    <div className="relative z-10 mx-auto w-full max-w-4xl overflow-y-auto p-6 sm:p-8">
      <div className="flex items-center gap-4">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Auditoría
        </h1>
        <nav className="flex gap-1 text-sm">
          <Link
            href="/admin/users"
            className="rounded-lg px-2.5 py-1 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Usuarios
          </Link>
          <span className="rounded-lg bg-surface-2 px-2.5 py-1 font-medium">
            Auditoría
          </span>
        </nav>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Los {logs.length} eventos de seguridad y operación más recientes.
      </p>

      {logs.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">Todavía no hay eventos.</p>
      ) : (
        // overflow-x-auto: en móvil la tabla se desplaza en vez de recortarse.
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Cuándo</th>
                <th className="px-4 py-3 font-semibold">Acción</th>
                <th className="px-4 py-3 font-semibold">Quién</th>
                <th className="px-4 py-3 font-semibold">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="bg-surface align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-muted tabular-nums">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        WARN_ACTIONS.has(log.action)
                          ? "font-medium text-danger"
                          : "font-medium"
                      }
                    >
                      {actionLabel(log.action)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {log.user ? (
                      <span title={log.user.email}>{log.user.name}</span>
                    ) : (
                      <span className="italic">—</span>
                    )}
                    {log.ip && (
                      <span className="ml-1 text-xs text-ink-muted/70">
                        ({log.ip})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-muted">
                    {[log.targetType, log.detail].filter(Boolean).join(" · ") ||
                      "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
