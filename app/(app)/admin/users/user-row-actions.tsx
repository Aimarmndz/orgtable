"use client";

import { useState } from "react";
import {
  updateUserRole,
  resetUserPassword,
  deleteUser,
  revokeUserSessions,
} from "@/app/lib/actions/admin";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

// Acciones por fila del panel de administración: cambiar rol global, restablecer la
// contraseña (con un campo desplegable) y borrar la cuenta. Las acciones devuelven el
// resultado por redirección con query (?ok/?error) que la página traduce a un aviso.
export function UserRowActions({
  userId,
  role,
  isSelf,
}: {
  userId: string;
  role: "ADMIN" | "MEMBER";
  isSelf: boolean;
}) {
  const [resetting, setResetting] = useState(false);

  // No puedes cambiar tu propio rol ni borrarte: evita quedarte sin acceso de admin.
  if (isSelf) {
    return (
      <div className="flex items-center justify-end gap-2 text-xs text-ink-muted">
        <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium">
          Tú
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form action={updateUserRole}>
        <input type="hidden" name="userId" value={userId} />
        <select
          name="role"
          defaultValue={role}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-ink outline-none focus-visible:border-accent"
          aria-label="Rol global"
        >
          <option value="MEMBER">Miembro</option>
          <option value="ADMIN">Administrador</option>
        </select>
      </form>

      {resetting ? (
        <form
          action={resetUserPassword}
          className="flex items-center gap-1"
          onSubmit={() => setResetting(false)}
        >
          <input type="hidden" name="userId" value={userId} />
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Nueva contraseña"
            autoComplete="new-password"
            className="h-8 w-40 text-xs"
          />
          <Button type="submit" variant="subtle" className="h-8 px-2.5 text-xs">
            Guardar
          </Button>
          <button
            type="button"
            onClick={() => setResetting(false)}
            className="text-xs text-ink-muted hover:text-ink"
          >
            Cancelar
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setResetting(true)}
          className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          Restablecer contraseña
        </button>
      )}

      <form action={revokeUserSessions}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          title="Cierra todas las sesiones activas de este usuario"
        >
          Cerrar sesiones
        </button>
      </form>

      <form
        action={deleteUser}
        onSubmit={(e) => {
          if (!confirm("¿Borrar esta cuenta? Esta acción no se puede deshacer."))
            e.preventDefault();
        }}
      >
        <input type="hidden" name="userId" value={userId} />
        <button
          className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label="Borrar usuario"
        >
          ✕
        </button>
      </form>
    </div>
  );
}
