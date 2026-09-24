import Link from "next/link";
import { requireAdmin } from "@/app/lib/dal";
import { getAllUsers } from "@/app/lib/queries";
import { formatDate } from "@/app/lib/format-date";
import { CreateUserForm } from "./create-user-form";
import { UserRowActions } from "./user-row-actions";

// Mensajes que devuelven las acciones por fila vía ?ok=… / ?error=… (ver admin.ts).
const OK_MESSAGES: Record<string, string> = {
  role: "Rol actualizado.",
  password:
    "Contraseña restablecida. Se han cerrado las sesiones del usuario y revocado sus tokens de API.",
  delete: "Usuario borrado.",
  revoked: "Sesiones cerradas.",
};
const ERROR_MESSAGES: Record<string, string> = {
  "self-role": "No puedes cambiar tu propio rol.",
  "self-delete": "No puedes borrar tu propia cuenta.",
  "owns-boards":
    "Ese usuario es propietario de tableros. Transfiérelos o bórralos antes de eliminar la cuenta.",
  password: "La contraseña debe tener al menos 8 caracteres.",
  invalid: "Datos no válidos.",
  "not-found": "Ese usuario ya no existe.",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const admin = await requireAdmin();
  const [{ ok, error }, users] = await Promise.all([
    searchParams,
    getAllUsers(),
  ]);

  return (
    <div className="relative z-10 mx-auto w-full max-w-4xl overflow-y-auto p-6 sm:p-8">
      <div className="flex items-center gap-4">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Usuarios
        </h1>
        <nav className="flex gap-1 text-sm">
          <span className="rounded-lg bg-surface-2 px-2.5 py-1 font-medium">
            Usuarios
          </span>
          <Link
            href="/admin/audit"
            className="rounded-lg px-2.5 py-1 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            Auditoría
          </Link>
        </nav>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Administra las cuentas de tu instancia: altas, roles y contraseñas.
      </p>

      {ok && OK_MESSAGES[ok] && (
        <p className="mt-4 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          {OK_MESSAGES[ok]}
        </p>
      )}
      {error && ERROR_MESSAGES[error] && (
        <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {ERROR_MESSAGES[error]}
        </p>
      )}

      <div className="mt-6">
        <CreateUserForm />
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Usuario</th>
              <th className="px-4 py-3 font-semibold">Tableros</th>
              <th className="px-4 py-3 font-semibold">Alta</th>
              <th className="px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="bg-surface">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{u.name}</span>
                    {u.role === "ADMIN" && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted">{u.email}</div>
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  <span title="Tableros propios">{u._count.boards}</span>
                  <span className="text-ink-muted/50"> · </span>
                  <span title="Tableros donde es miembro">
                    {u._count.memberships}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  {formatDate(u.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <UserRowActions
                    userId={u.id}
                    role={u.role}
                    isSelf={u.id === admin.id}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
