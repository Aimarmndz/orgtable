import type { Metadata } from "next";
import { requireAdmin } from "@/app/lib/dal";
import { AdminNav } from "../admin-nav";
import { getRecentAuditLogs } from "@/app/lib/queries";
import type { AuditAction } from "@/app/lib/audit";
import { formatDateTime } from "@/app/lib/format-date";

export const metadata: Metadata = {
  title: "Auditoría",
  description: "Eventos recientes de seguridad y operación de la instancia.",
};

// Etiquetas legibles para cada acción auditada.
const ACTION_LABELS: Record<AuditAction, string> = {
  "setup.completed": "Configuración inicial completada",
  "auth.login": "Inicio de sesión",
  "auth.login_failed": "Inicio de sesión fallido",
  "auth.login_rate_limited": "Login bloqueado por límite de intentos",
  "auth.logout": "Cierre de sesión",
  "auth.registered": "Cuenta creada desde el registro",
  "auth.register_rate_limited": "Registro bloqueado por límite de altas",
  "account.updated": "Perfil cambiado",
  "account.password_changed": "Contraseña cambiada por su titular",
  "account.sessions_revoked": "Sesiones cerradas por su titular",
  "account.exported": "Datos personales descargados",
  "account.deleted": "Cuenta borrada por su titular",
  "instance.updated": "Ajustes de la instancia cambiados",
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
  "auth.register_rate_limited",
  "user.deleted",
  "account.deleted",
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Auditoría
        </h1>
        <AdminNav current="/admin/audit" />
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
