"use client";

import { useActionState, useEffect, useRef } from "react";
import { createUser, type CreateUserState } from "@/app/lib/actions/admin";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

// Alta de usuario por el administrador. useActionState da feedback inline; al crear
// con éxito se limpia el formulario. Ver app/lib/actions/admin.ts.
export function CreateUserForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<CreateUserState, FormData>(
    createUser,
    {},
  );

  // Limpia el formulario cuando el alta tiene éxito (llega un message).
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state.message]);

  return (
    <form
      ref={ref}
      action={action}
      className="rounded-xl border border-border bg-surface p-5"
    >
      <h2 className="text-sm font-semibold">Crear cuenta</h2>
      <p className="mt-1 text-sm text-ink-muted">
        No hay registro abierto: aquí das de alta a las personas de tu instancia.
      </p>

      {state.error && (
        <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Nombre
          </span>
          <Input
            name="name"
            required
            maxLength={60}
            defaultValue={state.values?.name}
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Email
          </span>
          <Input
            name="email"
            type="email"
            required
            defaultValue={state.values?.email}
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Contraseña inicial
          </span>
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Rol
          </span>
          {/* React restablece el formulario a sus valores por defecto tras la acción,
              pero no actualiza el defaultValue de un <select> ya montado: la key lo
              remonta con lo elegido para no perderlo (p. ej. Administrador). */}
          <select
            key={state.values?.role ?? "MEMBER"}
            name="role"
            defaultValue={state.values?.role ?? "MEMBER"}
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            <option value="MEMBER">Miembro</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </label>
      </div>

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? "Creando…" : "Crear usuario"}
      </Button>
    </form>
  );
}
