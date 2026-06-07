"use client";

import { useActionState } from "react";
import { completeSetup, type SetupState } from "@/app/lib/actions/setup";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(
    completeSetup,
    {},
  );

  return (
    <form
      action={action}
      className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-[0_24px_48px_-24px_oklch(0.27_0.022_52/0.25)]"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-accent font-display text-lg font-extrabold text-accent-ink">
          o
        </span>
        <span className="font-display text-lg font-bold tracking-tight">
          orgtable
        </span>
      </div>

      <h1 className="mt-7 font-display text-2xl font-bold tracking-tight">
        Configura tu instancia
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        Este asistente solo aparece una vez. Crea tu cuenta de administrador.
      </p>

      {state.error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Instancia
        </legend>
        <label className="mt-3 block text-sm font-medium">
          Nombre de la instancia
          <Input
            name="instanceName"
            type="text"
            required
            maxLength={60}
            placeholder="Mi equipo"
            className="mt-1.5"
          />
        </label>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Administrador
        </legend>
        <div className="mt-3 space-y-4">
          <label className="block text-sm font-medium">
            Tu nombre
            <Input
              name="name"
              type="text"
              required
              maxLength={60}
              autoComplete="name"
              className="mt-1.5"
            />
          </label>
          <label className="block text-sm font-medium">
            Email
            <Input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1.5"
            />
          </label>
          <label className="block text-sm font-medium">
            Contraseña
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1.5"
            />
            <span className="mt-1 block text-xs text-ink-muted">
              Mínimo 8 caracteres.
            </span>
          </label>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending} className="mt-6 w-full">
        {pending ? "Creando…" : "Crear y entrar"}
      </Button>
    </form>
  );
}
